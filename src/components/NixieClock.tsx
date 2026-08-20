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

  /** The fascia the tubes are mounted behind. Grain is expensive and static. */
  const face = document.createElement("canvas");
  const fctx = face.getContext("2d");
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

    fascia();
  }

  /**
   * The panel material.
   *
   * Painted to its own surface once, because both the wood grain and the
   * brushed grain are hundreds of random strokes: regenerating them per frame
   * would cost real time and, worse, would shimmer — the grain would be a
   * different piece of timber sixty times a second.
   */
  function fascia() {
    if (!fctx) return;

    face.width = Math.max(1, Math.round(W * dpr));
    face.height = Math.max(1, Math.round(H * dpr));
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const kind = settings().nixiePanel;

    if (kind === "vanta") {
      fctx.fillStyle = "#000";
      fctx.fillRect(0, 0, W, H);
      return;
    }

    if (kind === "walnut") {
      const wood = fctx.createLinearGradient(0, 0, 0, H);
      wood.addColorStop(0, "#4a2f1c");
      wood.addColorStop(0.45, "#3b2415");
      wood.addColorStop(1, "#2a1810");
      fctx.fillStyle = wood;
      fctx.fillRect(0, 0, W, H);

      // Grain: long, shallow, mostly parallel arcs. Wood is not a stripe
      // pattern — the lines wander and bunch, and the bunching is what reads.
      const lines = Math.round(H * 0.9);
      for (let i = 0; i < lines; i++) {
        const y = Math.random() * H;
        const bow = (Math.random() - 0.5) * H * 0.05;
        const a = Math.random() * 0.06;
        fctx.strokeStyle =
          Math.random() < 0.45
            ? `rgba(255,225,190,${a})`
            : `rgba(20,10,4,${a * 1.6})`;
        fctx.lineWidth = Math.random() < 0.12 ? 2.2 : 0.8;
        fctx.beginPath();
        fctx.moveTo(-10, y);
        fctx.quadraticCurveTo(W / 2, y + bow, W + 10, y + bow * 0.3);
        fctx.stroke();
      }
      return;
    }

    const base = fctx.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, "#8f8a80");
    base.addColorStop(0.5, "#7c776e");
    base.addColorStop(1, "#615d56");
    fctx.fillStyle = base;
    fctx.fillRect(0, 0, W, H);

    const lines = Math.round(H * 1.4);
    for (let i = 0; i < lines; i++) {
      const y = Math.random() * H;
      const a = Math.random() * 0.05;
      fctx.fillStyle =
        Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      fctx.fillRect(0, y, W, Math.random() < 0.15 ? 1.5 : 0.7);
    }
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

  type Slot = { x: number; y: number; w: number; h: number; lit: number | null };

  /** The hole in the fascia a tube is seen through. */
  type Hole = { x: number; y: number; w: number; h: number; r: number };

  /**
   * Tighter than the tube behind it, on purpose.
   *
   * The panel has to overlap the glass, because that is what mounting is: a
   * hole slightly smaller than the thing behind it. Make the aperture match the
   * tube and you get a tube with a line drawn round it; make it smaller and the
   * rim and the base disappear behind the fascia, and what is left in the hole
   * is glass.
   */
  function aperture({ x, y, w, h }: Slot): Hole {
    const bulbW = w * 0.86 * 0.9;
    const bulbH = h * 0.86 * 0.94;
    return {
      x: x + w / 2 - bulbW / 2,
      y: y + h * 0.03 + h * 0.86 * 0.03,
      w: bulbW,
      h: bulbH,
      r: Math.min(bulbW * 0.42, bulbH * 0.3),
    };
  }

  function holePath(target: CanvasRenderingContext2D, hole: Hole) {
    if (typeof target.roundRect === "function") {
      target.roundRect(hole.x, hole.y, hole.w, hole.h, [
        hole.r,
        hole.r,
        hole.r * 0.35,
        hole.r * 0.35,
      ]);
    } else {
      target.rect(hole.x, hole.y, hole.w, hole.h);
    }
  }

  /**
   * Everything inside the glass: the envelope, the pool of light the discharge
   * throws onto its far wall, and the whole stack of cathodes.
   *
   * Note what is *not* here. The mesh and the glass sit in front of the
   * discharge, so they cannot be drawn until after it has been composited —
   * that is the entire reason this is split in two.
   */
  function tubeBody({ x, y, w, h, lit }: Slot) {
    const S = settings();

    const cx = x + w / 2;
    const cy = y + h * 0.46;
    const size = Math.min(h * 0.52, w * 0.95);
    const wire = Math.max(1, size * 0.062);

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

    const inside = ctx.createLinearGradient(bx, by, bx + bulbW, by + bulbH);
    inside.addColorStop(0, "#0b0907");
    inside.addColorStop(0.5, "#141010");
    inside.addColorStop(1, "#080706");
    ctx.fillStyle = inside;
    ctx.fill();
    ctx.clip();

    const dim = clamp(
      1 - surge * 0.35 * S.nixieFlicker + level * 0.12 * S.nixieFlicker,
      0,
      1,
    );

    // The discharge is a light source sitting inside a glass box, so the box is
    // lit. Without this the numeral glows into a vacuum and the tube around it
    // stays as black as the gap between tubes — which is the tell that there is
    // no tube there at all.
    if (lit !== null && S.nixieGlow > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.1);
      pool.addColorStop(0, `rgba(${NEON},${0.1 * dim})`);
      pool.addColorStop(0.5, `rgba(${NEON},${0.045 * dim})`);
      pool.addColorStop(1, `rgba(${NEON},0)`);
      ctx.fillStyle = pool;
      ctx.fillRect(bx, by, bulbW, bulbH);
      ctx.restore();
    }

    const depth = lit === null ? -1 : STACK.indexOf(lit);
    const ghost = S.nixieGhost;

    // Cathodes behind the lit one. They are metal a few millimetres from a
    // light source, so they pick it up rather than being invisible.
    for (let i = STACK.length - 1; i >= 0; i--) {
      const d = STACK[i];
      if (d === lit) continue;
      if (depth >= 0 && i <= depth) continue;

      const k = i / (STACK.length - 1);
      numeral(
        ctx,
        d,
        cx,
        cy + k * size * 0.012,
        size * (1 - k * 0.05),
        `rgba(${NEON},${0.08 * ghost * (1 - k * 0.35)})`,
        wire * 0.8,
      );
    }

    // --- the discharge -----------------------------------------------------
    if (lit !== null) {
      // Added, not painted over. Light sums, and the places where a numeral
      // crosses itself are brighter for it — which alpha compositing cannot
      // do, since it replaces what is underneath instead of adding to it.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      // Three coats, widest and faintest first: the plasma is densest against
      // the metal and thins outward into the gas.
      numeral(ctx, lit, cx, cy, size, `rgba(${NEON},${0.18 * dim})`, wire * 2.4);
      numeral(ctx, lit, cx, cy, size, `rgba(${NEON},${0.5 * dim})`, wire * 1.35);
      numeral(ctx, lit, cx, cy, size, `rgba(${NEON_CORE},${0.55 * dim})`, wire * 0.8);
      ctx.restore();

      if (gctx) {
        gctx.save();
        gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        gctx.globalCompositeOperation = "lighter";
        numeral(gctx, lit, cx, cy, size, `rgba(${NEON},${dim})`, wire * 1.2);
        gctx.restore();
      }

      // And the cathode itself, dark down the middle of its own glow.
      //
      // This is the part that had to be got wrong before it could be seen: the
      // wire does not emit. It is metal. What glows is the gas around it, so
      // the hottest thing is a sheath hugging the surface and the surface is a
      // shadow in the middle of it. Skipped when the stroke is too fine to hold
      // a core, because below a pixel it only dims the numeral.
      if (wire * 0.3 > 1.1) {
        numeral(ctx, lit, cx, cy, size, `rgba(14,7,3,${0.4 * dim})`, wire * 0.3);
      }
    }

    // Cathodes in front. Silhouettes, because they are between you and the
    // discharge — but metal catches an edge off a source that close, so a
    // little comes back rather than none.
    for (let i = 0; i < STACK.length; i++) {
      const d = STACK[i];
      if (d === lit) continue;
      if (depth >= 0 && i > depth) continue;

      const k = i / (STACK.length - 1);
      const gy = cy + k * size * 0.012;
      const gs = size * (1 - k * 0.05);

      numeral(ctx, d, cx, gy, gs, `rgba(10,6,4,${0.55 * ghost})`, wire * 0.85);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      numeral(ctx, d, cx, gy, gs, `rgba(${NEON},${0.13 * ghost * dim})`, wire * 0.3);
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Everything between the discharge and the eye: the anode mesh, the glass,
   * and the base.
   *
   * Drawn after the glow has been composited, which is the whole point. The
   * mesh is a screen *in front* of the cathodes — you look at the numeral
   * through it — so its fine dark lines have to cut across the lit glyph. Draw
   * it before the glow and the glow washes it away exactly where it was meant
   * to read, which is what the first version did.
   */
  function tubeFront({ x, y, w, h }: Slot) {
    const cx = x + w / 2;
    const size = Math.min(h * 0.52, w * 0.95);

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
    ctx.clip();

    const step = Math.max(3, size * 0.075);
    ctx.lineWidth = Math.max(0.4, size * 0.008);
    ctx.beginPath();
    for (let gx = bx; gx < bx + bulbW; gx += step) {
      ctx.moveTo(gx, by);
      ctx.lineTo(gx, by + bulbH);
    }
    for (let gy = by; gy < by + bulbH; gy += step) {
      ctx.moveTo(bx, gy);
      ctx.lineTo(bx + bulbW, gy);
    }

    // The wire occludes...
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = "#000";
    ctx.stroke();

    // ...and catches the light coming through it.
    ctx.globalAlpha = 0.1;
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#8a6a45";
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // Two reflections, because a cylinder gives a bright one where the light is
    // and a weaker one wrapping the far edge.
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

    ctx.strokeStyle = "rgba(190,175,150,0.22)";
    ctx.lineWidth = Math.max(0.7, size * 0.014);
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(bx, by, bulbW, bulbH, [radius, radius, radius * 0.3, radius * 0.3]);
    } else {
      ctx.rect(bx, by, bulbW, bulbH);
    }
    ctx.stroke();

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

  /**
   * The neon separator between the pairs.
   *
   * Lit, and staying lit. Blinking it is the reflex — every digital clock does
   * — but it is a reflex from seven-segment displays, where the blink was
   * doing a job: telling you the thing was still running. A nixie has a second
   * hand made of two more tubes, or it does not, and either way there is
   * nothing left for a blink to say. On a wall it is just a thing twitching at
   * you once a second.
   */
  function colon(x: number, w: number, h: number) {
    const S = settings();
    const cx = x + w / 2;
    const r = Math.max(1.5, Math.min(w, h) * 0.035);
    const dim = clamp(1 - surge * 0.3 * S.nixieFlicker, 0, 1);

    for (const at of [0.38, 0.56]) {
      const cy = h * at;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
      halo.addColorStop(0, `rgba(${NEON},${0.5 * dim})`);
      halo.addColorStop(1, `rgba(${NEON},0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(cx - r * 3, cy - r * 3, r * 6, r * 6);

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${NEON_CORE},${dim})`;
      ctx.fill();
      ctx.restore();

      if (gctx) {
        gctx.save();
        gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        gctx.globalCompositeOperation = "lighter";
        gctx.beginPath();
        gctx.arc(cx, cy, r, 0, Math.PI * 2);
        gctx.fillStyle = `rgba(${NEON},${dim})`;
        gctx.fill();
        gctx.restore();
      }
    }
  }

  function draw() {
    const S = settings();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
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
    // anywhere, so its ghosts are still there — which is what a real clock
    // looks like at nine o'clock.
    const digits: (number | null)[] = [
      blank ? null : Math.floor(hours / 10),
      hours % 10,
      Math.floor(now.getMinutes() / 10),
      now.getMinutes() % 10,
    ];
    if (S.nixieSeconds) {
      digits.push(Math.floor(now.getSeconds() / 10), now.getSeconds() % 10);
    }

    const gaps = S.nixieSeconds ? 2 : 1;
    const units = digits.length + gaps * 0.45;
    const unit = Math.min(W / units, H * 0.62);
    const tubeW = unit;
    const gapW = unit * 0.45;
    const total = digits.length * tubeW + gaps * gapW;
    const th = Math.min(H * 0.86, unit * 1.7);
    const y = (H - th) / 2;

    const slots: Slot[] = [];
    const colons: number[] = [];
    let x = (W - total) / 2;
    digits.forEach((d, i) => {
      slots.push({ x, y, w: tubeW, h: th, lit: d });
      x += tubeW;
      if (i === 1 || (i === 3 && S.nixieSeconds)) {
        colons.push(x);
        x += gapW;
      }
    });

    for (const slot of slots) tubeBody(slot);
    for (const cx of colons) colon(cx, gapW, H);

    // --- the discharge, spilling out of the tubes ---------------------------
    // Neon wraps its cathode rather than sitting on it, so this is not a
    // finishing pass — it is most of what the eye reads as a nixie. Two widths:
    // one for the gas immediately around the wire, one wide enough that the
    // envelope glows as an object and throws light onto its neighbours.
    if (gctx && canBlur && S.nixieGlow > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      ctx.filter = `blur(${Math.max(3, unit * 0.05)}px)`;
      ctx.globalAlpha = clamp(S.nixieGlow, 0, 1.6) * 0.6;
      ctx.drawImage(glow, 0, 0, W, H);

      ctx.filter = `blur(${Math.max(10, unit * 0.24)}px)`;
      ctx.globalAlpha = clamp(S.nixieGlow, 0, 1.6) * 0.3;
      ctx.drawImage(glow, 0, 0, W, H);

      ctx.filter = "none";
      ctx.restore();
    }

    // The mesh and the glass are in front of all of that.
    for (const slot of slots) tubeFront(slot);

    // --- the fascia ---------------------------------------------------------
    //
    // Drawn over the finished tubes rather than behind them, which is the only
    // way round that reads as mounting. A panel painted first and tubes drawn
    // on top is a picture of tubes lying on a panel; a panel drawn last, with
    // holes in it, is a panel with tubes behind it. The difference costs one
    // even-odd fill.
    const holes: Hole[] = slots.map(aperture);
    for (const cx of colons) {
      const r = Math.max(2, Math.min(gapW, th) * 0.05);
      for (const at of [0.38, 0.56]) {
        holes.push({
          x: cx + gapW / 2 - r * 1.7,
          y: H * at - r * 1.7,
          w: r * 3.4,
          h: r * 3.4,
          r: r * 1.7,
        });
      }
    }

    if (fctx) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      for (const hole of holes) holePath(ctx, hole);
      ctx.clip("evenodd");
      ctx.drawImage(face, 0, 0, W, H);
      ctx.restore();
    }

    // The edge of each hole: the panel has thickness, so the top of the cut is
    // in shadow and the bottom catches whatever the tube is throwing at it.
    for (const hole of holes) {
      const lip = ctx.createLinearGradient(0, hole.y, 0, hole.y + hole.h);
      lip.addColorStop(0, "rgba(0,0,0,0.75)");
      lip.addColorStop(0.45, "rgba(0,0,0,0.25)");
      lip.addColorStop(1, "rgba(255,220,180,0.14)");
      ctx.strokeStyle = lip;
      ctx.lineWidth = Math.max(1, unit * 0.018);
      ctx.beginPath();
      holePath(ctx, hole);
      ctx.stroke();
    }

    // And the light the tubes throw back onto the panel around them. A lit tube
    // in a hole spills onto the fascia; without it the panel is a flat colour
    // with cutouts and the tubes are stickers in the cutouts.
    if (S.nixieGlow > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      slots.forEach((slot, i) => {
        if (slot.lit === null) return;
        const hole = holes[i];
        const cx = hole.x + hole.w / 2;
        const cy = hole.y + hole.h / 2;
        const spill = ctx.createRadialGradient(
          cx,
          cy,
          hole.h * 0.4,
          cx,
          cy,
          hole.h * 1.05,
        );
        spill.addColorStop(0, `rgba(${NEON},${0.14 * clamp(S.nixieGlow, 0, 1.6)})`);
        spill.addColorStop(1, `rgba(${NEON},0)`);
        ctx.fillStyle = spill;
        ctx.fillRect(cx - hole.h * 1.1, cy - hole.h * 1.1, hole.h * 2.2, hole.h * 2.2);
      });
      ctx.restore();
    }

    // The faint blue-violet cast off the mercury some tubes carry, which is
    // what stops the whole picture being one hue.
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

  // Everything else here is read on the frame that uses it. The fascia is not:
  // it is a canvas of static grain, painted once.
  let panel = settings().nixiePanel;
  const unsubscribe = subscribeSettings(() => {
    const next = settings().nixiePanel;
    if (next === panel) return;
    panel = next;
    fascia();
  });

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
