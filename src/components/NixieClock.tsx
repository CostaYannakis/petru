"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { MicSource } from "@/lib/mic";
import type { ThemeName } from "@/lib/palette";
import { settings, subscribeSettings } from "@/lib/settings-store";

/**
 * A nixie clock.
 *
 * A nixie is not a display. It is ten numerals of bent wire, stacked one behind
 * another inside a neon envelope, and a supply that lights exactly one of them
 * at a time by making the gas around it discharge. Everything that makes one
 * look like a nixie follows from that sentence:
 *
 * The numerals are *stroked*, not filled, because they are wire. A filled digit
 * is the single thing that makes a fake nixie look fake, and it is the easiest
 * mistake to make because every font is filled by default.
 *
 * The nine unlit cathodes are still in there. You can see them — dark wire
 * shapes crowding the lit one — and some of them are physically *in front*, so
 * they cross the glow and occlude it. That is where a tube's depth comes from,
 * and a number drawn on a screen has none of it. It is the whole illusion, and
 * it costs nine extra strokes.
 *
 * The glow does not sit on the wire, it wraps it: neon discharges into the gas
 * around the cathode, so the bloom is the point and the sharp core is only its
 * centre. Every lit numeral goes to one offscreen surface and is blurred back
 * over the scene in a single pass, rather than each digit carrying its own
 * expensive shadow.
 *
 * And it is a clock. The room is allowed to move its brightness — the supply
 * sagging under a loud passage — and nothing else, because a clock that danced
 * would have stopped being a clock.
 */

const BANDS = 16;

/**
 * The stacking order, front to back, as the cathodes are actually assembled in
 * the common Soviet tubes. It matters: it decides which ghosts cross in front
 * of the lit numeral, and therefore where the glow gets interrupted.
 */
const STACK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

/**
 * Neon, and not negotiable. Every other screen takes its colour from the ramp;
 * this one cannot, because the colour of a nixie is the emission line of the
 * gas inside it. A blue nixie is not a nixie.
 */
const NEON = "255,176,62";
const NEON_CORE = "255,232,190";

/** The faint blue-violet cast off the mercury some tubes carry. */
const MERCURY = "150,140,255";

const FONT = `ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function setup(
  host: HTMLDivElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  micRef: RefObject<MicSource | null>,
) {
  const glow = document.createElement("canvas");
  const gctx = glow.getContext("2d");
  const canBlur = typeof ctx.filter === "string";

  let W = 0;
  let H = 0;
  let dpr = 1;

  const bands = new Float32Array(BANDS);
  let level = 0;
  let surge = 0;

  let raf = 0;
  let running = true;

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
  }

  function listen() {
    const mic = micRef.current;
    if (!mic) {
      level += (0.18 - level) * 0.02;
      surge *= 0.94;
      return;
    }

    mic.read(bands);
    let all = 0;
    for (let i = 0; i < BANDS; i++) all += bands[i];
    all /= BANDS;

    const was = level;
    level += (all - level) * (all > level ? 0.25 : 0.05);

    // A rise the supply could not keep up with. Only ever a dip in brightness,
    // never a movement — the tubes sag, they do not dance.
    const jump = Math.max(0, level - was);
    surge = Math.max(surge * 0.9, clamp(jump * 8, 0, 1));
  }

/**
   * One numeral, in wire.
   *
   * Stroked rather than filled, which is the whole difference between a nixie
   * and a number: the cathodes are bent wire, and a filled glyph is the single
   * thing that gives a fake one away. Round joins and caps, because wire has no
   * corners.
   */
  function numeral(
    target: CanvasRenderingContext2D,
    d: number,
    cx: number,
    cy: number,
    size: number,
    style: string,
    width: number,
  ) {
    target.font = `500 ${size}px ${FONT}`;
    target.textAlign = "center";
    target.textBaseline = "middle";
    target.lineJoin = "round";
    target.lineCap = "round";
    target.lineWidth = width;
    target.strokeStyle = style;
    target.strokeText(String(d), cx, cy);
  }

  /** One tube: envelope, the whole stack of cathodes, and the mesh in front. */
  function tube(x: number, y: number, w: number, h: number, lit: number | null) {
    const S = settings();

    const cx = x + w / 2;
    const cy = y + h * 0.46;
    const size = Math.min(h * 0.52, w * 0.95);
    const wire = Math.max(1, size * 0.062);

    // --- the envelope ------------------------------------------------------
    const bulbW = w * 0.86;
    const bulbH = h * 0.86;
    const bx = cx - bulbW / 2;
    const by = y + h * 0.03;
    const radius = Math.min(bulbW * 0.42, bulbH * 0.3);

    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(bx, by, bulbW, bulbH, [radius, radius, radius * 0.3, radius * 0.3]);
    } else {
      ctx.rect(bx, by, bulbW, bulbH);
    }

    // Glass over near-black. The inside of a tube is dark, and the little that
    // is there is the far wall catching the discharge.
    const inside = ctx.createLinearGradient(bx, by, bx + bulbW, by + bulbH);
    inside.addColorStop(0, "#0b0907");
    inside.addColorStop(0.5, "#141010");
    inside.addColorStop(1, "#080706");
    ctx.fillStyle = inside;
    ctx.fill();
    ctx.clip();

    // --- the cathode stack -------------------------------------------------
    // Drawn back to front. The ones ahead of the lit numeral are drawn after it
    // and therefore cross it, which is the depth cue the whole tube rests on.
    const depth = lit === null ? -1 : STACK.indexOf(lit);

    const ghost = S.nixieGhost;
    for (let i = STACK.length - 1; i >= 0; i--) {
      const d = STACK[i];
      if (d === lit) continue;

      // Further back is smaller and dimmer, which is all the perspective a
      // stack a few millimetres deep actually gives you.
      const behind = depth < 0 || i > depth;
      const k = i / (STACK.length - 1);
      const scale = 1 - k * 0.05;
      const fade = (behind ? 0.16 : 0.26) * ghost * (1 - k * 0.35);

      if (behind) {
        numeral(
          ctx,
          d,
          cx,
          cy + k * size * 0.012,
          size * scale,
          `rgba(${NEON},${fade * 0.5})`,
          wire * 0.8,
        );
      }
    }

    // --- the lit cathode ---------------------------------------------------
    if (lit !== null) {
      const dim =
        1 - surge * 0.35 * S.nixieFlicker + level * 0.12 * S.nixieFlicker;

      // The core, sharp, on the scene; and the same stroke on the glow surface,
      // which is blurred back over everything in one pass at the end.
      numeral(ctx, lit, cx, cy, size, `rgba(${NEON_CORE},${clamp(dim, 0, 1)})`, wire * 0.62);
      numeral(ctx, lit, cx, cy, size, `rgba(${NEON},${clamp(dim * 0.85, 0, 1)})`, wire);

      if (gctx) {
        gctx.save();
        gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        numeral(gctx, lit, cx, cy, size, `rgba(${NEON},${clamp(dim, 0, 1)})`, wire);
        gctx.restore();
      }
    }

    // Ghosts in front, drawn over the glow so they interrupt it.
    for (let i = 0; i < STACK.length; i++) {
      const d = STACK[i];
      if (d === lit) continue;
      if (depth >= 0 && i > depth) continue;

      const k = i / (STACK.length - 1);
      const scale = 1 - k * 0.05;

      // Dark wire, not dim light: a cathode in front of the discharge is a
      // silhouette. Drawing these as faint orange is the tempting mistake and
      // it flattens the tube completely.
      numeral(
        ctx,
        d,
        cx,
        cy + k * size * 0.012,
        size * scale,
        `rgba(10,6,4,${0.5 * ghost})`,
        wire * 0.85,
      );
      numeral(
        ctx,
        d,
        cx,
        cy + k * size * 0.012,
        size * scale,
        `rgba(${NEON},${0.1 * ghost})`,
        wire * 0.4,
      );
    }

    // --- the anode mesh ----------------------------------------------------
    // A fine screen sits between the cathodes and the glass on a real tube, and
    // it is the detail that stops the numerals looking like they are painted on
    // the front of the envelope.
    ctx.globalAlpha = 0.13;
    ctx.strokeStyle = "#c9b79a";
    ctx.lineWidth = Math.max(0.4, size * 0.008);
    const step = Math.max(3, size * 0.075);
    ctx.beginPath();
    for (let gx = bx; gx < bx + bulbW; gx += step) {
      ctx.moveTo(gx, by);
      ctx.lineTo(gx, by + bulbH);
    }
    for (let gy = by; gy < by + bulbH; gy += step) {
      ctx.moveTo(bx, gy);
      ctx.lineTo(bx + bulbW, gy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // --- the glass ---------------------------------------------------------
    // Two reflections, because a cylinder gives you a bright one on the side
    // the light is on and a weaker one where it wraps around the far edge.
    const sheen = ctx.createLinearGradient(bx, by, bx + bulbW, by);
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    sheen.addColorStop(0.1, "rgba(255,255,255,0.16)");
    sheen.addColorStop(0.2, "rgba(255,255,255,0)");
    sheen.addColorStop(0.82, "rgba(255,255,255,0)");
    sheen.addColorStop(0.9, "rgba(255,255,255,0.07)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(bx, by, bulbW, bulbH);

    ctx.restore();

    // Rim.
    ctx.strokeStyle = "rgba(190,175,150,0.22)";
    ctx.lineWidth = Math.max(0.7, size * 0.014);
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(bx, by, bulbW, bulbH, [radius, radius, radius * 0.3, radius * 0.3]);
    } else {
      ctx.rect(bx, by, bulbW, bulbH);
    }
    ctx.stroke();

    // --- the base ----------------------------------------------------------
    const baseH = h * 0.1;
    const baseY = by + bulbH - baseH * 0.2;
    const base = ctx.createLinearGradient(0, baseY, 0, baseY + baseH);
    base.addColorStop(0, "#2a2320");
    base.addColorStop(1, "#100c0a");
    ctx.fillStyle = base;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(bx + bulbW * 0.06, baseY, bulbW * 0.88, baseH, baseH * 0.25);
    } else {
      ctx.rect(bx + bulbW * 0.06, baseY, bulbW * 0.88, baseH);
    }
    ctx.fill();
  }

  /** The neon separator between the pairs, on its own little bulb. */
  function colon(x: number, w: number, h: number, on: boolean) {
    const S = settings();
    const cx = x + w / 2;
    const r = Math.max(1.5, Math.min(w, h) * 0.035);
    const dim = on ? 1 - surge * 0.3 * S.nixieFlicker : 0.06;

    for (const at of [0.38, 0.56]) {
      const cy = h * at;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${NEON_CORE},${clamp(dim, 0, 1)})`;
      ctx.fill();

      if (on && gctx) {
        gctx.save();
        gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        gctx.beginPath();
        gctx.arc(cx, cy, r, 0, Math.PI * 2);
        gctx.fillStyle = `rgba(${NEON},${clamp(dim, 0, 1)})`;
        gctx.fill();
        gctx.restore();
      }
    }
  }

  function draw() {
    const S = settings();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    // Nixies live in the dark, and a dark room is where the glow is worth
    // anything at all.
    ctx.fillStyle = "#050403";
    ctx.fillRect(0, 0, W, H);

    if (gctx) {
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.clearRect(0, 0, glow.width, glow.height);
    }

    const now = new Date();
    let hours = now.getHours();
    let blank = false;
    if (!S.nixie24) {
      const h12 = hours % 12 || 12;
      blank = h12 < 10;
      hours = h12;
    }

    // A blanked leading tube is unlit, not absent. The cathodes do not go
    // anywhere, so the ghosts are still there — which is exactly what a real
    // clock looks like at nine o'clock.
    const digits: (number | null)[] = [
      blank ? null : Math.floor(hours / 10),
      hours % 10,
      Math.floor(now.getMinutes() / 10),
      now.getMinutes() % 10,
    ];
    if (S.nixieSeconds) {
      digits.push(Math.floor(now.getSeconds() / 10), now.getSeconds() % 10);
    }

    // Tubes get a full slot each, separators a narrow one.
    const gaps = S.nixieSeconds ? 2 : 1;
    const units = digits.length + gaps * 0.45;
    const unit = Math.min(W / units, H * 0.62);
    const tubeW = unit;
    const gapW = unit * 0.45;
    const total = digits.length * tubeW + gaps * gapW;

    let x = (W - total) / 2;
    const y = (H - Math.min(H * 0.86, unit * 1.7)) / 2;
    const th = Math.min(H * 0.86, unit * 1.7);

    const blink = now.getMilliseconds() < 500;

    digits.forEach((d, i) => {
      tube(x, y, tubeW, th, d);
      x += tubeW;
      if (i === 1 || (i === 3 && S.nixieSeconds)) {
        colon(x, gapW, H, blink);
        x += gapW;
      }
    });

    // --- the discharge -----------------------------------------------------
    // One blur for every lit cathode in the scene. Neon wraps its wire rather
    // than sitting on it, so this pass is not a finishing touch — it is most of
    // what the eye reads as a nixie.
    if (gctx && canBlur && S.nixieGlow > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      ctx.filter = `blur(${Math.max(3, unit * 0.06)}px)`;
      ctx.globalAlpha = clamp(S.nixieGlow, 0, 1.6) * 0.75;
      ctx.drawImage(glow, 0, 0, W, H);

      // A second, wider pass: the gas lights the whole envelope faintly, and
      // the tube glows as an object rather than the numeral glowing alone.
      ctx.filter = `blur(${Math.max(10, unit * 0.22)}px)`;
      ctx.globalAlpha = clamp(S.nixieGlow, 0, 1.6) * 0.35;
      ctx.drawImage(glow, 0, 0, W, H);

      ctx.filter = "none";
      ctx.restore();
    }

    // The mercury cast, which is what stops the whole picture being one hue.
    if (S.nixieGlow > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.05 * clamp(S.nixieGlow, 0, 1.6);
      ctx.fillStyle = `rgb(${MERCURY})`;
      ctx.fillRect(0, y, W, th * 0.5);
      ctx.restore();
    }

    ctx.globalCompositeOperation = "source-over";
  }

  /**
   * No clock of its own to advance, and so no `dt` and nothing to integrate:
   * the only thing moving here is the time, and the time is read straight off
   * the system. `prefers-reduced-motion` has nothing to slow either — a clock
   * that ran slow would simply be wrong.
   */
  function frame() {
    if (!running) return;

    listen();
    draw();

    raf = requestAnimationFrame(frame);
  }

  build();
  raf = requestAnimationFrame(frame);

  const ro = new ResizeObserver(() => build());
  ro.observe(host);

  const unsubscribe = subscribeSettings(() => {});

  function onVisibility() {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!running) {
      running = true;
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

/**
 * `theme` is accepted so the screens stay interchangeable, and deliberately
 * ignored: the colour of a nixie is the emission line of the gas inside it, and
 * no palette gets a say in that.
 */
export default function NixieClock({
  micRef,
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

    return setup(host, canvas, ctx, micRef);
  }, [micRef]);

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
