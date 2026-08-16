"use client";

import { useEffect, useRef } from "react";
import { LED_BODY, LED_FULL, LED_OFF, PANEL_BLACK } from "@/lib/palette";

/**
 * A dot-matrix LED panel, the kind bolted into an audio visualiser.
 *
 * Every frame builds one array — `level`, a value per LED — and then the panel
 * is drawn from it. Nothing else touches the canvas, so whatever produces the
 * levels (a mirrored spectrum analyser, or the wordmark) gets the identical
 * physical treatment: square LEDs on a fixed pitch, smoked black when off,
 * colour banded by distance from the centre line, and a bloom pass so lit
 * cells bleed into the gaps the way real diodes do.
 */

const WORD = "PETRU";

// One full cycle of the panel: analyser, wipe to the wordmark, hold, wipe back.
const SPECTRUM_MS = 11_000;
const WIPE_MS = 900;
const HOLD_MS = 3_600;

const SANS = `ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function setup(
  host: HTMLDivElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
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
  let rows = 0; // always even, so the mirror has a clean seam
  let half = 0;
  let pitch = 0; // centre-to-centre spacing of LEDs
  let ledSize = 0;
  let radius = 0;
  let originX = 0;
  let originY = 0;
  let dpr = 1;

  // --- signal -------------------------------------------------------------
  let bands = new Float32Array(0); // smoothed amplitude per column, 0..1
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
    // panel's centre line, so it uses the whole band — golden yellow along the
    // cap line down to ember at the baseline — instead of sitting in the ember
    // rows. Measured from the raster, so it doesn't depend on font metrics.
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

    // Chunky, square, and an even row count. ~20 rows on a phone in landscape
    // keeps the LEDs big enough to read as discrete diodes.
    rows = clamp(Math.round(H / 19), 12, 30);
    if (rows % 2) rows += 1;
    half = rows / 2;

    pitch = H / rows;
    cols = Math.max(4, Math.floor(W / pitch));

    ledSize = pitch * 0.82;
    radius = ledSize * 0.26;

    // Centre the grid; the leftover is a hair under one LED on each axis.
    originX = (W - cols * pitch) / 2;
    originY = (H - rows * pitch) / 2;

    bands = new Float32Array(cols);
    level = new Float32Array(cols * rows);
    tone = new Float32Array(cols * rows);

    seeds = new Float32Array(cols);
    for (let c = 0; c < cols; c++) seeds[c] = Math.random() * Math.PI * 2;

    buildWord();
  }

  /**
   * A synthetic spectrum. No microphone — nothing here asks the viewer for
   * permission — but shaped like one: bass on the left, a tilted noise floor,
   * and a kick that ducks the low bands on the beat.
   */
  function drive(dt: number) {
    const beat = 0.5; // 120bpm
    const phase = (t % beat) / beat;
    const kick = Math.exp(-phase * 6.5);

    // Slow swell so the panel breathes across a bar or two.
    const swell = 0.72 + 0.28 * Math.sin(t * 0.31);

    for (let c = 0; c < cols; c++) {
      const f = cols > 1 ? c / (cols - 1) : 0;
      const s = seeds[c];

      // Spectral tilt: louder at the bass end, but the treble still has life
      // rather than dying off into a flat row of unlit columns.
      const tilt = 0.5 + 0.5 * Math.pow(1 - f, 1.3);

      // Per-column phase is what keeps adjacent bars from moving as one slab.
      let n = 0;
      n += Math.sin(t * 2.1 + s) * 0.5;
      n += Math.sin(t * 3.7 + s * 2.3) * 0.3;
      n += Math.sin(t * 0.9 + s * 0.6) * 0.34;
      n += Math.sin(t * 5.9 + s * 3.7) * 0.14;
      n = (n / 1.28) * 0.5 + 0.5;
      n = Math.pow(n, 1.4); // bias low, so the panel keeps some dark in it

      const low = kick * Math.pow(1 - f, 2.6) * 0.45;

      // Gain is set so a typical bar reaches the amber/orange rows and only
      // peaks touch golden yellow — the whole band in play, nothing pinned.
      const target = clamp((tilt * n * 1.3 + low) * swell, 0, 1);

      // Analyser ballistics: snap up, fall away slowly.
      const k = target > bands[c] ? dt * 24 : dt * 5.5;
      bands[c] += (target - bands[c]) * Math.min(1, k);
    }
  }

  /** Where in the cycle we are, and how far the wordmark has wiped across. */
  function wordWipe(ms: number) {
    const cycle = SPECTRUM_MS + WIPE_MS + HOLD_MS + WIPE_MS;
    const p = ms % cycle;

    if (p < SPECTRUM_MS) return 0;
    if (p < SPECTRUM_MS + WIPE_MS) return (p - SPECTRUM_MS) / WIPE_MS;
    if (p < SPECTRUM_MS + WIPE_MS + HOLD_MS) return 1;
    return 1 - (p - SPECTRUM_MS - WIPE_MS - HOLD_MS) / WIPE_MS;
  }

  /** Fill `level` from whichever source owns each column this frame. */
  function compose(ms: number) {
    const wipe = wordWipe(ms);
    const edge = wipe * cols;

    const span = half > 1 ? half - 1 : 1;

    for (let c = 0; c < cols; c++) {
      const showWord = c < edge;

      if (showWord) {
        // The wipe edge itself runs hot, like the panel is being written to.
        const hot = edge - c < 1.6;
        const rise = wordBottom > wordTop ? wordBottom - wordTop : 1;
        for (let r = 0; r < rows; r++) {
          const idx = r * cols + c;
          const d = r < half ? half - 1 - r : r - half;
          if (word[idx]) {
            level[idx] = 1;
            tone[idx] = clamp((wordBottom - r) / rise, 0, 1);
          } else if (hot) {
            level[idx] = 0.34;
            tone[idx] = 1; // the write head reads as a golden seam
          } else {
            level[idx] = 0;
            tone[idx] = d / span;
          }
        }
        continue;
      }

      const lit = Math.round(bands[c] * half);
      for (let d = 0; d < half; d++) {
        // Mirrored around the seam: d is distance from the centre line.
        const up = (half - 1 - d) * cols + c;
        const down = (half + d) * cols + c;
        // The outermost lit LED is the brightest thing in the column.
        const v = d < lit ? (d === lit - 1 ? 1 : 0.82) : 0;
        const band = d / span;
        level[up] = v;
        level[down] = v;
        tone[up] = band;
        tone[down] = band;
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
        const full = LED_FULL[bandIdx];
        const body = LED_BODY[bandIdx];

        ctx.fillStyle = v <= 0 ? LED_OFF : v >= 1 ? full : body;

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
      if (canBlur) {
        ctx.filter = `blur(${Math.max(2.5, pitch * 0.36)}px)`;
        ctx.globalAlpha = 0.72;
      } else {
        ctx.globalAlpha = 0.3;
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
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

export default function LedPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    return setup(host, canvas, ctx);
  }, []);

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
