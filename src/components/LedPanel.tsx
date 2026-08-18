"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { MicSource } from "@/lib/mic";
import {
  DEFAULT_THEME,
  PANEL_BLACK,
  ramp,
  type Ramp,
  type ThemeName,
} from "@/lib/palette";
import { settings, subscribeSettings } from "@/lib/settings";

/**
 * A dot-matrix LED panel, the kind bolted into an audio visualiser.
 *
 * Every frame builds one array — `level`, a value per LED — and then the panel
 * is drawn from it. Nothing else touches the canvas, so whatever produces the
 * levels (the spectrum analyser, or the wordmark) gets the identical physical
 * treatment: square LEDs on a fixed pitch, smoked black when off, colour banded
 * by height up the panel, and a bloom pass so lit cells bleed into the gaps the
 * way real diodes do.
 *
 * Bars stand on the bottom row and grow upward, so a column's height is read
 * off the deck like any other meter and the colour band is the scale beside it.
 *
 * Which colours those are is the one thing the panel takes from outside: a
 * theme name, resolved to a pair of pre-baked ramps in src/lib/palette.ts.
 */

const WORD = "PETRU";

const SANS = `ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;

/**
 * Everything the panel is tuned by now lives in src/lib/settings.ts, along with
 * the reasoning that used to sit here as comments on each constant. It is read
 * per frame rather than captured at setup, so /admin can move a value and see
 * it on the panel immediately. The defaults there are exactly the constants
 * this file used to hold.
 */

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function setup(
  host: HTMLDivElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  micRef: RefObject<MicSource | null>,
  colours: Ramp,
) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const glow = document.createElement("canvas");
  const gctx = glow.getContext("2d");
  const canBlur = typeof ctx.filter === "string";
  const canRound = typeof ctx.roundRect === "function";

  // --- panel geometry -----------------------------------------------------
  let W = 0;
  let H = 0;
  let cols = 0;
  let rows = 0;
  let pitch = 0; // centre-to-centre spacing of LEDs
  let ledSize = 0;
  let radius = 0;
  let originX = 0;
  let originY = 0;
  let dpr = 1;

  // --- signal -------------------------------------------------------------
  let bands = new Float32Array(0); // smoothed amplitude per column, 0..1
  let targets = new Float32Array(0); // this frame's raw amplitude per column
  let peaks = new Float32Array(0); // each column's high-water line, 0..1
  let holds = new Float32Array(0); // ...and how long it stays parked there
  let seeds = new Float32Array(0); // fixed per-column phase, so neighbours differ
  let word = new Uint8Array(0); // wordmark, 1 bit per LED
  let wordTop = 0; // the wordmark's cap row
  let wordBottom = 1; // ...and its baseline row
  let level = new Float32Array(0); // per-LED drive for this frame
  let tone = new Float32Array(0); // per-LED position on the colour band, 0..1

  let t = 0; // seconds since mount
  let raf = 0;
  let last = 0;
  let running = true;

  /**
   * Rasterise WORD into the LED grid.
   *
   * Drawn in screen coordinates through a transform that squashes into grid
   * space, so the LED pitch doesn't distort the letterforms; supersampled and
   * thresholded, because an LED is on or off.
   */
  function buildWord() {
    word = new Uint8Array(cols * rows);
    if (!cols || !rows) return;

    const SS = 4;
    const mc = document.createElement("canvas");
    mc.width = cols * SS;
    mc.height = rows * SS;
    const mx = mc.getContext("2d", { willReadFrequently: true });
    if (!mx) return;

    const gridW = cols * pitch;
    const gridH = rows * pitch;
    mx.setTransform((cols * SS) / gridW, 0, 0, (rows * SS) / gridH, 0, 0);

    const tracking = Math.round(gridW * 0.02);
    const setTracking = () => {
      try {
        mx.letterSpacing = `${tracking}px`;
      } catch {
        // Safari < 17.4: no tracking, the fit below still holds.
      }
    };

    mx.font = `900 100px ${SANS}`;
    setTracking();

    const w100 = mx.measureText(WORD).width || 1;
    const fontSize = Math.min(((gridW * 0.9) / w100) * 100, gridH * 0.78);

    mx.font = `900 ${fontSize}px ${SANS}`;
    setTracking();
    mx.textAlign = "center";
    mx.textBaseline = "alphabetic";
    mx.fillStyle = "#fff";

    // Centre on the ink, not the em box: an all-caps word has no descenders,
    // so "middle" would hang it high on the panel.
    const m = mx.measureText(WORD);
    const ascent = m.actualBoundingBoxAscent || fontSize * 0.72;
    const descent = m.actualBoundingBoxDescent || 0;
    mx.fillText(WORD, gridW / 2, gridH / 2 + (ascent - descent) / 2);

    const data = mx.getImageData(0, 0, mc.width, mc.height).data;
    const need = SS * SS * 255 * 0.42; // an LED lights on ~42% coverage

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        for (let sy = 0; sy < SS; sy++) {
          const y = r * SS + sy;
          let p = (y * mc.width + c * SS) * 4 + 3; // alpha
          for (let sx = 0; sx < SS; sx++) {
            sum += data[p];
            p += 4;
          }
        }
        word[r * cols + c] = sum >= need ? 1 : 0;
      }
    }

    // The wordmark is coloured across its own bounding rows rather than the
    // panel's full height, so it uses the whole band — the top colour along the
    // cap line down to the bottom colour at the baseline — instead of sitting
    // in whichever rows it happens to occupy. Measured from the raster, not
    // from font metrics.
    wordTop = rows;
    wordBottom = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (word[r * cols + c]) {
          if (r < wordTop) wordTop = r;
          if (r > wordBottom) wordBottom = r;
          break;
        }
      }
    }
    if (wordBottom < wordTop) {
      wordTop = 0;
      wordBottom = Math.max(1, rows - 1);
    }
  }

  function build() {
    const rect = host.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);

    dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    glow.width = canvas.width;
    glow.height = canvas.height;

    // Chunky and square. Every row is a step on the amplitude scale now, so
    // there is no parity to keep — the count is whatever the height affords.
    rows = clamp(Math.round(H / settings().pitch), 6, 30);

    pitch = H / rows;
    cols = Math.max(4, Math.floor(W / pitch));

    ledSize = pitch * 0.82;
    radius = ledSize * 0.26;

    // Centre the grid; the leftover is a hair under one LED on each axis.
    originX = (W - cols * pitch) / 2;
    originY = (H - rows * pitch) / 2;

    bands = new Float32Array(cols);
    targets = new Float32Array(cols);
    peaks = new Float32Array(cols);
    holds = new Float32Array(cols);
    level = new Float32Array(cols * rows);
    tone = new Float32Array(cols * rows);

    seeds = new Float32Array(cols);
    for (let c = 0; c < cols; c++) seeds[c] = Math.random() * Math.PI * 2;

    buildWord();
  }

  /**
   * The idle spectrum, used until someone turns the microphone on. Shaped like
   * the real thing: bass on the left, a tilted noise floor, and a kick on the
   * beat — but entirely synthetic, so the panel is alive on load without the
   * page having asked the viewer for anything.
   */
  function fillSynthetic() {
    const beat = 0.5; // 120bpm
    const phase = (t % beat) / beat;
    const kick = Math.exp(-phase * 6.5);

    // Slow swell so the panel breathes across a bar or two. Shallow, because
    // with only a dozen rows a deep swell reads as the panel switching off
    // rather than getting quieter.
    const swell = 0.85 + 0.15 * Math.sin(t * 0.31);

    for (let c = 0; c < cols; c++) {
      const f = cols > 1 ? c / (cols - 1) : 0;
      const s = seeds[c];

      // Spectral tilt: still leaning on the bass end, but only just. The mic
      // path corrects its own tilt now, and this should match what that gives
      // — a panel that moves right the way across, not one that fades out.
      const tilt = 0.74 + 0.26 * Math.pow(1 - f, 1.3);

      // Per-column phase is what keeps adjacent bars from moving as one slab.
      let n = 0;
      n += Math.sin(t * 2.1 + s) * 0.5;
      n += Math.sin(t * 3.7 + s * 2.3) * 0.3;
      n += Math.sin(t * 0.9 + s * 0.6) * 0.34;
      n += Math.sin(t * 5.9 + s * 3.7) * 0.14;
      n = (n / 1.28) * 0.5 + 0.5;
      n = Math.pow(n, 1.4); // bias low, so the panel keeps some dark in it

      const low = kick * Math.pow(1 - f, 2.6) * 0.8;

      // Weighted toward the kick rather than the wash, so this rests low and
      // moves on the beat — the same shape the mic gives once `PUNCH` has
      // pulled the middle of its range down.
      targets[c] = clamp((tilt * n * 1.1 + low) * swell, 0, 1);
    }
  }

  /**
   * Take this frame's raw levels from whichever source is live, then apply the
   * ballistics both share: snap up fast, fall away slowly. Doing the smoothing
   * here rather than per-source is what makes the microphone feel like the
   * same instrument as the idle animation.
   */
  function drive(dt: number) {
    const S = settings();
    const mic = micRef.current;
    if (mic) mic.read(targets);
    else fillSynthetic();

    // How much real signal is on the panel right now. In a silent room the
    // gate leaves this at zero and the wander below takes over entirely.
    let peak = 0;
    for (let c = 0; c < cols; c++) if (targets[c] > peak) peak = targets[c];
    const quiet = clamp(1 - peak / S.quietAt, 0, 1);

    for (let c = 0; c < cols; c++) {
      // Expanded first, so the wander below is compared against a level that
      // has already been pushed down — otherwise the drift would be competing
      // with the loud reading rather than the honest one.
      let raw = Math.pow(targets[c], S.punch);

      if (quiet > 0) {
        // Three incommensurate rates off a fixed per-column seed: it never
        // repeats, and neighbouring columns drift independently.
        const s = seeds[c];
        let n = Math.sin(t * 1.1 + s) * 0.55;
        n += Math.sin(t * 2.2 + s * 2.1) * 0.3;
        n += Math.sin(t * 0.55 + s * 0.7) * 0.4;
        n = (n / 1.25) * 0.5 + 0.5;

        const wander = n * S.shimmer * quiet;
        if (wander > raw) raw = wander;
      }

      // A grid this coarse only has a dozen steps, so a raw 0 reads as a dead
      // column rather than a quiet one. Lift everything onto a floor: the
      // bottom row stays lit, the way it does on real hardware.
      const target = S.floor + (1 - S.floor) * raw;

      // Hard attack, quick release: the bar is up on the transient and back
      // down before the next one, which is what stops a busy passage from
      // smearing into one lit slab and leaves the markers to hold the history.
      const k = target > bands[c] ? dt * S.attack : dt * S.release;
      bands[c] += (target - bands[c]) * Math.min(1, k);

      // The marker takes a new high instantly, then parks before it starts to
      // sink. It can never fall past the bar, so a column that's still loud
      // carries its own marker on top rather than leaving one behind inside.
      if (bands[c] >= peaks[c]) {
        peaks[c] = bands[c];
        holds[c] = S.peakHold;
      } else if (holds[c] > 0) {
        holds[c] -= dt;
      } else {
        peaks[c] = Math.max(bands[c], peaks[c] - S.peakFall * dt);
      }
    }

    // A rare, small twinkle on top, so the quiet panel reads as alive rather
    // than as a smooth pattern cycling. Roughly one column every couple of
    // seconds, lifted by a row or so — any more and the rest is no longer rest.
    if (quiet > 0.4 && Math.random() < dt * 0.7) {
      const c = (Math.random() * cols) | 0;
      bands[c] = Math.min(1, bands[c] + 0.08 + Math.random() * 0.12);
    }
  }

  /** Where in the cycle we are, and how far the wordmark has wiped across. */
  function wordWipe(ms: number) {
    const { wordmark, spectrumMs, wipeMs, holdMs } = settings();
    if (!wordmark) return 0;

    const cycle = spectrumMs + wipeMs + holdMs + wipeMs;
    const p = ms % cycle;

    if (p < spectrumMs) return 0;
    if (p < spectrumMs + wipeMs) return (p - spectrumMs) / wipeMs;
    if (p < spectrumMs + wipeMs + holdMs) return 1;
    return 1 - (p - spectrumMs - wipeMs - holdMs) / wipeMs;
  }

  /** Fill `level` from whichever source owns each column this frame. */
  function compose(ms: number) {
    const wipe = wordWipe(ms);
    const edge = wipe * cols;

    const span = rows > 1 ? rows - 1 : 1;

    for (let c = 0; c < cols; c++) {
      const showWord = c < edge;

      if (showWord) {
        // The wipe edge itself runs hot, like the panel is being written to.
        const hot = edge - c < 1.6;
        const rise = wordBottom > wordTop ? wordBottom - wordTop : 1;
        for (let r = 0; r < rows; r++) {
          const idx = r * cols + c;
          if (word[idx]) {
            level[idx] = 1;
            tone[idx] = clamp((wordBottom - r) / rise, 0, 1);
          } else if (hot) {
            level[idx] = 0.34;
            tone[idx] = 1; // the write head reads as a seam at the top colour
          } else {
            level[idx] = 0;
            tone[idx] = (rows - 1 - r) / span;
          }
        }
        continue;
      }

      // h is height above the bottom row, which is both how far the bar has
      // climbed and where its LEDs sit on the colour band.
      const lit = Math.round(bands[c] * rows);
      const mark = clamp(Math.round(peaks[c] * rows) - 1, 0, rows - 1);

      for (let h = 0; h < rows; h++) {
        const idx = (rows - 1 - h) * cols + c;
        // The topmost lit LED is the brightest thing in the column, and so is
        // the marker floating in the dark above it.
        const v = h < lit ? (h === lit - 1 ? 1 : 0.82) : h === mark ? 1 : 0;
        level[idx] = v;
        tone[idx] = h / span;
      }
    }
  }

  function draw() {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = PANEL_BLACK;
    ctx.fillRect(0, 0, W, H);

    if (gctx) {
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.clearRect(0, 0, glow.width, glow.height);
      gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const inset = (pitch - ledSize) / 2;

    for (let r = 0; r < rows; r++) {
      const y = originY + r * pitch + inset;
      const rowOff = r * cols;

      for (let c = 0; c < cols; c++) {
        const idx = rowOff + c;
        const v = level[idx];
        const x = originX + c * pitch + inset;

        const bandIdx = (tone[idx] * 255) | 0;
        const full = colours.full[bandIdx];
        const body = colours.body[bandIdx];

        ctx.fillStyle = v <= 0 ? colours.off : v >= 1 ? full : body;

        ctx.beginPath();
        if (canRound) {
          ctx.roundRect(x, y, ledSize, ledSize, radius);
        } else {
          ctx.rect(x, y, ledSize, ledSize);
        }
        ctx.fill();

        if (gctx && v > 0) {
          gctx.fillStyle = v >= 1 ? full : body;
          gctx.beginPath();
          if (canRound) {
            gctx.roundRect(x, y, ledSize, ledSize, radius);
          } else {
            gctx.rect(x, y, ledSize, ledSize);
          }
          gctx.fill();
        }
      }
    }

    if (gctx) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const { bloom } = settings();
      if (canBlur) {
        ctx.filter = `blur(${Math.max(2.5, pitch * 0.36)}px)`;
        ctx.globalAlpha = bloom;
      } else {
        // No filter support, so the same pass lands as a hard double-exposure.
        // Scaled well down, or it reads as smeared rather than glowing.
        ctx.globalAlpha = bloom * 0.42;
      }
      ctx.drawImage(glow, 0, 0, W, H);
      ctx.filter = "none";
      ctx.restore();
    }
  }

  function frame(now: number) {
    if (!running) return;

    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    t += dt * (reduced ? 0.35 : 1);

    drive(dt);
    compose(t * 1000);
    draw();

    raf = requestAnimationFrame(frame);
  }

  build();
  raf = requestAnimationFrame(frame);

  const ro = new ResizeObserver(() => build());
  ro.observe(host);

  // Nearly every setting is read inside the frame that uses it and so needs
  // nothing here. The LED pitch is the exception: it decides the row and column
  // counts, and those size every buffer the panel owns, so a change has to go
  // back through build() rather than being picked up on the next frame.
  let pitchTarget = settings().pitch;
  const unsubscribe = subscribeSettings(() => {
    const next = settings().pitch;
    if (next === pitchTarget) return;
    pitchTarget = next;
    build();
  });

  function onVisibility() {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!running) {
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    running = false;
    cancelAnimationFrame(raf);
    ro.disconnect();
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

export default function LedPanel({
  micRef,
  theme = DEFAULT_THEME,
}: {
  micRef: RefObject<MicSource | null>;
  theme?: ThemeName;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    // A theme change tears the panel down and rebuilds it. The ramps are
    // baked once per theme, so the only real cost is a lost frame.
    return setup(host, canvas, ctx, micRef, ramp(theme));
  }, [micRef, theme]);

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
