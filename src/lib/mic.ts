/**
 * Live audio for the panel.
 *
 * iOS gives no way to tap what another app is playing, so this listens to the
 * room: the phone hears the speakers. Nothing here runs until the viewer asks
 * for it — `startMic` must be called from inside a user gesture, both because
 * that is the only way Safari will unlock an AudioContext and because a page
 * should not reach for a microphone on its own.
 */

export type MicSource = {
  /** Fill `out` with a 0..1 level per column, bass first. */
  read(out: Float32Array): void;
  stop(): void;
};

// The band the panel actually shows. Below ~45Hz is mostly rumble; above
// ~12kHz there is rarely enough energy in music to move a bar.
const F_MIN = 45;
const F_MAX = 12_000;

// Anything under this is treated as room hiss rather than signal.
const NOISE_GATE = 0.05;

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
  analyser.minDecibels = -85;
  analyser.maxDecibels = -12;

  // Note the analyser is deliberately not connected onward to the
  // destination: routing the mic back to the speakers would howl.
  ctx.createMediaStreamSource(stream).connect(analyser);

  const bins = new Uint8Array(analyser.frequencyBinCount);
  const ratio = F_MAX / F_MIN;
  let agc = 0.35;
  let stopped = false;

  return {
    read(out) {
      if (stopped) return;

      analyser.getByteFrequencyData(bins);
      const nyquist = ctx.sampleRate / 2;
      const n = out.length;
      let loudest = 0;

      for (let c = 0; c < n; c++) {
        // Columns are spaced logarithmically, the way pitch is heard —
        // linear bins would cram every instrument into the left edge.
        const f0 = F_MIN * Math.pow(ratio, c / n);
        const f1 = F_MIN * Math.pow(ratio, (c + 1) / n);

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
        const mean = sum / (i1 - i0);
        let v = (mean * 0.45 + peak * 0.55) / 255;

        // Music rolls off toward the treble; the panel shouldn't go dead
        // there, so lift the top end a little.
        v *= 0.8 + 0.75 * (c / n);

        v = v > NOISE_GATE ? v - NOISE_GATE : 0;

        out[c] = v;
        if (v > loudest) loudest = v;
      }

      // Slow auto-gain so a quiet room and a loud one both fill the panel:
      // jump straight to a new peak, then bleed back down.
      agc = loudest > agc ? loudest : agc * 0.992 + loudest * 0.008;
      const scale = 1 / (agc > 0.1 ? agc : 0.1);

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
