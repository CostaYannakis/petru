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
//
// This is the other half of sensitivity, and it pulls the opposite way: the
// window below decides how loudly the panel hears, the gate decides what it
// refuses to hear at all. Both are set high — hear a conversation across the
// room, and hold completely still for an empty one — because what makes sound
// look explosive is the silence it starts from.
const NOISE_GATE = 0.055;

/**
 * The window the byte spectrum is mapped across. This is the sensitivity knob:
 * the analyser stretches `MIN_DB`..`MAX_DB` over 0..255, so lowering the pair
 * means less sound in the room is needed to fill the panel.
 *
 * -25dB at the top is well under a loud speaker, which is the point — the
 * panel should be moving properly at conversation level and pinned by music,
 * rather than saving its top rows for a volume nobody plays at indoors. The
 * window stays about 70dB wide so there is still a ramp between the two.
 */
const MIN_DB = -95;
const MAX_DB = -25;

/**
 * How far the auto-gain will push a quiet room, as the smallest peak it will
 * normalise against — 1/0.11, so about nine times.
 *
 * The auto-gain exists to keep the panel usable at any volume, but taken too
 * far it is also the thing that flattens a room: left uncapped it would haul
 * near-silence up to full scale and the panel would never be still. Capping it
 * here is what leaves somewhere for a loud moment to go.
 */
const AGC_FLOOR = 0.11;

/**
 * Spectral tilt correction — what makes the whole width move rather than the
 * bass end alone.
 *
 * Music has far more energy at the bottom than the top, so the right-hand
 * columns sit permanently low no matter how sensitive the mic is, and the
 * global auto-gain makes it worse: it normalises against the loudest column,
 * which is nearly always a bass one, so the treble is scaled by somebody else's
 * gain. Expansion then squashes hardest exactly where there was least to begin
 * with, so raising `PUNCH` kills the right side first.
 *
 * The fix is a slow per-column average and a gain that pulls each column toward
 * the panel's mean — quiet columns up, loud ones gently down. `STRENGTH` just
 * under 1 leaves a little of the natural bass lean rather than ruling a
 * straight line across the panel.
 *
 * The gain is computed from the *average*, so it only flattens the standing
 * shape of the spectrum. Whatever a column does around its own average passes
 * through at full size, which is the whole point: it equalises the tilt without
 * touching the dynamics, so the treble dances as hard as the bass instead of
 * twitching along the bottom two rows.
 *
 * It corrects shape, never level: it runs on gated values, so a column with
 * nothing in it averages zero and gets lifted to zero. Silence stays silent.
 */
const TILT_STRENGTH = 0.9;
const TILT_MIN = 0.6; // most a loud column is pulled down
const TILT_MAX = 5; // most a quiet one is pushed up
const TILT_TRACK = 0.01; // per frame, so the average settles over a second or two

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
  analyser.minDecibels = MIN_DB;
  analyser.maxDecibels = MAX_DB;

  // Note the analyser is deliberately not connected onward to the
  // destination: routing the mic back to the speakers would howl.
  ctx.createMediaStreamSource(stream).connect(analyser);

  const bins = new Uint8Array(analyser.frequencyBinCount);
  const ratio = F_MAX / F_MIN;
  let agc = 0.35;
  let stopped = false;

  // Each column's own slow average, for the tilt correction. Sized on the
  // first read and again whenever the panel is rebuilt at a new width.
  let colAvg = new Float32Array(0);

  return {
    read(out) {
      if (stopped) return;

      analyser.getByteFrequencyData(bins);
      const nyquist = ctx.sampleRate / 2;
      const n = out.length;

      const sized = colAvg.length === n;
      if (!sized) colAvg = new Float32Array(n);

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
        const binMean = sum / (i1 - i0);
        const v0 = (binMean * 0.45 + peak * 0.55) / 255;

        out[c] = v0 > NOISE_GATE ? v0 - NOISE_GATE : 0;
      }

      // --- tilt: pull every column toward the panel's mean -----------------
      // Seeded from the first frame rather than crept up to from zero, so the
      // right-hand side isn't dead for the first second after switching on.
      let mean = 0;
      for (let c = 0; c < n; c++) {
        colAvg[c] = sized
          ? colAvg[c] + (out[c] - colAvg[c]) * TILT_TRACK
          : out[c];
        mean += colAvg[c];
      }
      mean /= n;

      let loudest = 0;

      // Below this the room is effectively empty, and there is no shape worth
      // correcting — only hiss to amplify into a shape.
      if (mean > 0.002) {
        for (let c = 0; c < n; c++) {
          const a = colAvg[c] > 1e-4 ? colAvg[c] : 1e-4;

          let g = Math.pow(mean / a, TILT_STRENGTH);
          if (g < TILT_MIN) g = TILT_MIN;
          else if (g > TILT_MAX) g = TILT_MAX;

          const v = out[c] * g;
          out[c] = v;
          if (v > loudest) loudest = v;
        }
      } else {
        for (let c = 0; c < n; c++) if (out[c] > loudest) loudest = out[c];
      }

      // Slow auto-gain so a quiet room and a loud one both fill the panel:
      // jump straight to a new peak, then bleed back down. The bleed is quick
      // enough that the panel recovers its reach a second or so after a loud
      // moment, rather than sulking through the quiet passage after it.
      agc = loudest > agc ? loudest : agc * 0.988 + loudest * 0.012;
      const scale = 1 / (agc > AGC_FLOOR ? agc : AGC_FLOOR);

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
