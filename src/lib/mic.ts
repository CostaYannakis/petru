/**
 * Live audio for the panel.
 *
 * iOS gives no way to tap what another app is playing, so this listens to the
 * room: the phone hears the speakers. Nothing here runs until the viewer asks
 * for it — `startMic` must be called from inside a user gesture, both because
 * that is the only way Safari will unlock an AudioContext and because a page
 * should not reach for a microphone on its own.
 */

import { settings } from "@/lib/settings-store";

export type MicSource = {
  /** Fill `out` with a 0..1 level per column, bass first. */
  read(out: Float32Array): void;
  stop(): void;
};

/**
 * The band the panel shows, the window the spectrum is stretched across, the
 * gate, the auto-gain and the tilt correction are all tunable now and live in
 * src/lib/settings.ts, with the reasoning that used to sit here beside each
 * constant. They are read per frame through the store, so the bench moves them
 * while the mic is running — including the analyser's own dB window, which is
 * pushed back into the node below whenever it changes.
 */

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

export async function startMic(): Promise<MicSource> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("no microphone API");
  }

  const Ctor =
    window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!Ctor) throw new Error("no Web Audio");

  // Both of these have to start inside the gesture, before any await, or iOS
  // leaves the context suspended and every read comes back silent.
  const ctx = new Ctor();
  const resumed = ctx.resume();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // This is a measurement, not a phone call — leave the signal alone.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  await resumed;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0; // the panel runs its own ballistics
  analyser.minDecibels = settings().minDb;
  analyser.maxDecibels = settings().maxDb;

  // Note the analyser is deliberately not connected onward to the
  // destination: routing the mic back to the speakers would howl.
  ctx.createMediaStreamSource(stream).connect(analyser);

  const bins = new Uint8Array(analyser.frequencyBinCount);
  let agc = 0;
  let stopped = false;

  // Each column's own slow average, for the tilt correction. Sized on the
  // first read and again whenever the panel is rebuilt at a new width.
  let colAvg = new Float32Array(0);

  return {
    read(out) {
      if (stopped) return;

      const S = settings();

      // The window is a property of the node, not of this loop, so it has to be
      // written back rather than simply read. Guarded, because assigning either
      // one every frame is a needless poke at the audio thread.
      if (analyser.minDecibels !== S.minDb || analyser.maxDecibels !== S.maxDb) {
        // The node rejects a window that isn't strictly increasing, and a
        // slider dragged past its partner will briefly ask for exactly that.
        if (S.minDb < S.maxDb) {
          // Order matters: setting min above the current max throws, so widen
          // from whichever end is safe first.
          if (S.minDb < analyser.maxDecibels) {
            analyser.minDecibels = S.minDb;
            analyser.maxDecibels = S.maxDb;
          } else {
            analyser.maxDecibels = S.maxDb;
            analyser.minDecibels = S.minDb;
          }
        }
      }

      analyser.getByteFrequencyData(bins);
      const nyquist = ctx.sampleRate / 2;
      const n = out.length;
      const ratio = S.fMax / S.fMin;

      const sized = colAvg.length === n;
      if (!sized) colAvg = new Float32Array(n);

      for (let c = 0; c < n; c++) {
        // Columns are spaced logarithmically, the way pitch is heard —
        // linear bins would cram every instrument into the left edge.
        const f0 = S.fMin * Math.pow(ratio, c / n);
        const f1 = S.fMin * Math.pow(ratio, (c + 1) / n);

        let i0 = Math.floor((f0 / nyquist) * bins.length);
        let i1 = Math.ceil((f1 / nyquist) * bins.length);
        if (i0 < 0) i0 = 0;
        if (i1 > bins.length) i1 = bins.length;
        if (i1 <= i0) i1 = Math.min(bins.length, i0 + 1);

        let sum = 0;
        let peak = 0;
        for (let i = i0; i < i1; i++) {
          const v = bins[i];
          sum += v;
          if (v > peak) peak = v;
        }

        // Mean alone reads mushy, peak alone jitters. Split the difference.
        const binMean = sum / (i1 - i0);
        const v0 = (binMean * 0.45 + peak * 0.55) / 255;

        out[c] = v0 > S.noiseGate ? v0 - S.noiseGate : 0;
      }

      // --- tilt: pull every column toward the panel's mean -----------------
      // Seeded from the first frame rather than crept up to from zero, so the
      // right-hand side isn't dead for the first second after switching on.
      let mean = 0;
      for (let c = 0; c < n; c++) {
        colAvg[c] = sized
          ? colAvg[c] + (out[c] - colAvg[c]) * S.tiltTrack
          : out[c];
        mean += colAvg[c];
      }
      mean /= n;

      // Below this the room is effectively empty, and there is no shape worth
      // correcting — only hiss to amplify into a shape.
      if (mean > 0.002) {
        for (let c = 0; c < n; c++) {
          const a = colAvg[c] > 1e-4 ? colAvg[c] : 1e-4;

          let g = Math.pow(mean / a, S.tiltStrength);
          if (g < S.tiltMin) g = S.tiltMin;
          else if (g > S.tiltMax) g = S.tiltMax;

          out[c] *= g;
        }
      }

      // How loud the panel is as a whole. A mean rather than a peak, so no
      // single column can decide the gain for all the others.
      let level = 0;
      for (let c = 0; c < n; c++) level += out[c];
      level /= n;

      // The reference drifts toward the room's level and is never pulled to a
      // transient, so over one beat it holds still and the loudness of a sound
      // is what decides the height of its bar. Seeded from the first frame, or
      // it would spend the opening seconds of a session crawling to the right
      // answer from a guess.
      agc = sized
        ? agc + (level - agc) * (level > agc ? S.agcUp : S.agcDown)
        : level;

      const ref = agc > S.agcFloor ? agc : S.agcFloor;
      const scale = 1 / (ref * S.agcRoom);

      for (let c = 0; c < n; c++) {
        const v = out[c] * scale;
        out[c] = v > 1 ? 1 : v;
      }
    },

    stop() {
      stopped = true;
      for (const track of stream.getTracks()) track.stop();
      void ctx.close();
    },
  };
}
