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
 * The auto-gain, and the thing that decides whether a beat is consistent.
 *
 * The whole panel is divided by one number, so what that number is measured
 * from matters enormously. Measuring it from the loudest column — the obvious
 * choice — means every element in the mix takes turns suppressing the others:
 * when a hi-hat lands it becomes the loudest column, the panel is divided by
 * the hat, and the kick underneath it drops by half. Nothing about the kick
 * changed. It just got measured against something else.
 *
 * So the reference is the mean across the whole panel. One loud column moves a
 * twenty-column mean barely at all, which is what lets the same sound land in
 * the same place whatever else is playing.
 *
 * It also moves slowly in both directions rather than snapping to peaks, since
 * a reference that jumps to the current peak maps every peak to full scale by
 * construction — a soft hit and a hard one would both hit the ceiling. Over one
 * beat this is effectively still, so the loudness of a sound is what decides
 * the height of its bar. `UP` is quicker than `DOWN` so turning the volume up
 * is followed in a second or so, while the fade after a loud passage is slow
 * enough not to read as pumping.
 */
const AGC_UP = 0.02; // per frame, so under a second
const AGC_DOWN = 0.006; // ...and a few seconds coming back down

/**
 * Headroom above the reference. The mean is well below the peaks it has to
 * leave room for, so this sets where ordinary content sits: at 1.8 a beat lands
 * around two thirds up and there are still four rows above it for something
 * genuinely louder to reach. Lower pins the panel, higher flattens it.
 */
const AGC_ROOM = 1.8;

/**
 * The smallest reference the gain will divide by, so a quiet room is lifted but
 * near-silence is not hauled up to full scale. In units of the panel mean,
 * which is a good deal smaller than the peak this used to be measured against.
 */
const AGC_FLOOR = 0.05;

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
/**
 * How fast the per-column average follows. Deliberately far slower than the
 * music: at a second or two it starts tracking the rhythm itself, and a column
 * that gets hit on every beat has its average dragged up and its gain pulled
 * down in response — the correction quietly cancelling the beat it was supposed
 * to be showing. Over ten seconds it can only see the standing shape of the
 * spectrum, which is the only thing it should be correcting.
 */
const TILT_TRACK = 0.0015;

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
  let agc = 0;
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

      // Below this the room is effectively empty, and there is no shape worth
      // correcting — only hiss to amplify into a shape.
      if (mean > 0.002) {
        for (let c = 0; c < n; c++) {
          const a = colAvg[c] > 1e-4 ? colAvg[c] : 1e-4;

          let g = Math.pow(mean / a, TILT_STRENGTH);
          if (g < TILT_MIN) g = TILT_MIN;
          else if (g > TILT_MAX) g = TILT_MAX;

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
      agc = sized ? agc + (level - agc) * (level > agc ? AGC_UP : AGC_DOWN) : level;

      const ref = agc > AGC_FLOOR ? agc : AGC_FLOOR;
      const scale = 1 / (ref * AGC_ROOM);

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
