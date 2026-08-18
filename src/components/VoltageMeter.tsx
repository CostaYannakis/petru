"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { MicSource } from "@/lib/mic";
import {
  DEFAULT_THEME,
  mixRgb,
  parseRgb,
  ramp,
  rgb,
  type Ramp,
  type ThemeName,
} from "@/lib/palette";
import { settings, subscribeSettings } from "@/lib/settings-store";

/**
 * A moving-coil voltage meter, of the kind bolted across the front of a deck.
 *
 * The needle is the point, and the needle is a *mechanism*: a coil with mass,
 * hung on a spring, pushed by the signal and fought by its own inertia. That is
 * why it cannot show you a level instantly, and the lag is not a defect to be
 * tuned out — it is the entire character. A VU meter is a low-pass filter you
 * can watch.
 *
 * So this is not a number smoothed toward a target, which is what an eased
 * value would be. It is a second-order system integrated every frame:
 *
 *   acceleration = stiffness x (target - angle) - damping x velocity
 *
 * Below critical damping the needle passes the mark and settles back, and that
 * small overshoot is most of why a real one looks alive rather than drawn. The
 * 300ms standard rise is not arbitrary either: it is roughly how the ear
 * integrates loudness, which is why the reading looks like what you are hearing
 * rather than like the waveform.
 *
 * The face is cream and lit from behind, because that is what these were. The
 * ramp survives in the danger arc and in the lamp behind the dial — a meter
 * face is ivory in every palette, the same way ferrofluid is black in all of
 * them.
 */

const BANDS = 32;

const SANS = `ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;

/** The face, in the order it is printed. `at` is a fraction along the arc. */
const MARKS: { at: number; label: string }[] = [
  { at: 0.0, label: "-20" },
  { at: 0.24, label: "-10" },
  { at: 0.35, label: "-7" },
  { at: 0.44, label: "-5" },
  { at: 0.54, label: "-3" },
  { at: 0.65, label: "-1" },
  { at: 0.72, label: "0" },
  { at: 0.82, label: "+1" },
  { at: 0.9, label: "+2" },
  { at: 1.0, label: "+3" },
];

/** Where the red starts. The same 0dB the lamp watches for. */
const OVER = 0.72;

/** How far the needle swings either side of vertical. */
const SWEEP = (52 * Math.PI) / 180;

const IVORY = "rgb(239,231,214)";
const INK = "#171310";

/**
 * The bulbs.
 *
 * A lamp behind a dial is incandescent, and incandescent is warm white — the
 * colour one of these receivers is remembered by is the *filter* in front of
 * the bulb, not the filament. So these are filters, and every one of them is a
 * long way toward white: a saturated fill behind a dial reads as a coloured
 * gel taped over the glass, never as a lit face.
 *
 * `ramp` is the exception, taking the panel's own palette so the meter can
 * match whatever the other two screens are wearing.
 */
const LAMPS: Record<string, [number, number, number]> = {
  warm: [255, 232, 196],
  amber: [255, 196, 122],
  red: [255, 138, 108],
  blue: [176, 220, 255],
  green: [178, 240, 198],
};

/** How much of the ramp survives when the lamp is following the palette. */
const TINT = 0.34;

/** Brass, brightest to deepest. */
const BRASS = ["#fff3cd", "#dcb96a", "#9c7c38", "#4a3818"];

/**
 * Where the light in this scene comes from: up and to the left, which is where
 * the glass sheen already says it is. Everything on the fascia has to agree
 * with it — a screw lit from its own direction is the loudest possible tell
 * that a picture was assembled rather than photographed.
 */
const LIGHT = (-135 * Math.PI) / 180;

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

type Needle = {
  /** Where it is, 0..1 along the scale. */
  at: number;
  /** ...and how fast it is going, which is the half an eased value throws away. */
  vel: number;
  /** Seconds left on the overload lamp. */
  lamp: number;
};

function setup(
  host: HTMLDivElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  micRef: RefObject<MicSource | null>,
  colours: Ramp,
) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0;
  let H = 0;
  let dpr = 1;

  const bands = new Float32Array(BANDS);
  let needles: Needle[] = [];

  // Resolved per frame rather than per mount, since the lamp is a knob now.
  // Both are cheap, and caching them would mean watching a setting to know when
  // the cache is stale — more machinery than the arithmetic it would save.
  function lamp() {
    const choice = settings().meterLamp;
    const base =
      choice === "ramp"
        ? mixRgb(
            parseRgb(colours.full[Math.round(0.6 * 255)]),
            LAMPS.warm,
            1 - TINT,
          )
        : (LAMPS[choice] ?? LAMPS.warm);

    // A filament is whiter at its centre than at its edges.
    return { base, hot: mixRgb(base, [255, 255, 255], 0.45) };
  }

  /** The brushed panel the instruments are set into, drawn once. */
  const panel = document.createElement("canvas");
  const pctx = panel.getContext("2d");

  let t = 0;
  let raf = 0;
  let last = 0;
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

    brush();
    fit();
  }

  /**
   * The surround: brushed aluminium, which is what these were bolted to.
   *
   * It matters more than it sounds. A backlight is only ever *relative* — a lit
   * face against a face-coloured background is not lit, it is just pale. The
   * panel is a shade down from the dial so the glow has something to be
   * brighter than, and it carries the horizontal grain of a brushed fascia,
   * which is the single strongest period cue in the whole picture.
   *
   * Drawn once on resize. The striations are random and there are hundreds of
   * them; regenerating that every frame would be absurd, and it would also
   * shimmer, since the grain would be different each time.
   */
  function brush() {
    if (!pctx) return;

    panel.width = Math.max(1, Math.round(W * dpr));
    panel.height = Math.max(1, Math.round(H * dpr));
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (settings().meterPanel === "vanta") {
      // Nothing at all. Not near-black, not a dark gradient — a gradient is
      // still a surface, and the point of putting these on vantablack is that
      // there is no surface: the instruments float, and the only thing in the
      // frame besides them is the light escaping their own bezels.
      pctx.fillStyle = "#000";
      pctx.fillRect(0, 0, W, H);
      return;
    }

    const base = pctx.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, "#cdc7ba");
    base.addColorStop(0.5, "#bdb6a7");
    base.addColorStop(1, "#a8a091");
    pctx.fillStyle = base;
    pctx.fillRect(0, 0, W, H);

    const lines = Math.round(H * 1.4);
    for (let i = 0; i < lines; i++) {
      const y = Math.random() * H;
      const a = Math.random() * 0.05;
      pctx.fillStyle =
        Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      pctx.fillRect(0, y, W, Math.random() < 0.15 ? 1.5 : 0.7);
    }
  }

  function fit() {
    const want = Math.round(clamp(settings().meterCount, 1, 4));
    const next: Needle[] = [];
    for (let i = 0; i < want; i++) {
      next.push(needles[i] ?? { at: 0, vel: 0, lamp: 0 });
    }
    needles = next;
  }

  /**
   * What each meter is reading. One takes the whole spectrum; more than one
   * splits it low to high, so a pair reads like the L/R of a deck while
   * actually telling you something — the mic is mono, and two identical needles
   * would be a lie told twice.
   */
  function drive(dt: number) {
    const S = settings();
    const mic = micRef.current;

    if (mic) {
      mic.read(bands);
    } else {
      // Nothing connected, so the meter idles the way a powered one does: a
      // slow drift with an occasional swell, never pinned and never dead.
      for (let i = 0; i < BANDS; i++) {
        const f = i / (BANDS - 1);
        const swell = 0.5 + 0.5 * Math.sin(t * 0.5 + f * 1.4);
        const beat = Math.exp(-((t % 0.55) / 0.55) * 6) * (1 - f) * 0.5;
        bands[i] = clamp(0.22 + swell * 0.2 + beat, 0, 1);
      }
    }

    const n = needles.length;
    const per = BANDS / n;

    // Natural frequency from the rise time. For a second-order system the time
    // to first reach the mark is (pi - acos(z)) / (w * sqrt(1 - z^2)), which at
    // the damping these run near enough works out at 3.4 / w — so a 300ms rise
    // wants w of about 11.4 rad/s. Solving it this way rather than picking a
    // stiffness by eye is what lets the rise knob be quoted in milliseconds and
    // actually mean it.
    const rise = Math.max(0.03, S.meterRise / 1000);
    const w = 3.42 / rise;
    const stiff = w * w;
    const damp = 2 * clamp(S.meterDamping, 0.1, 2) * w;

    for (let i = 0; i < n; i++) {
      const from = Math.floor(i * per);
      const to = Math.max(from + 1, Math.floor((i + 1) * per));

      let sum = 0;
      for (let b = from; b < to; b++) sum += bands[b];
      const level = sum / (to - from);

      // Just under unity, so ordinary content sits below 0dB and the red is
      // somewhere a needle has to be driven to rather than where it lives.
      const target = clamp(level * 0.95, 0, 1.04);

      const m = needles[i];
      const acc = stiff * (target - m.at) - damp * m.vel;
      m.vel += acc * dt;
      m.at += m.vel * dt;

      // The pin. A real needle stops against a post and does not bounce back
      // through the whole scale, so the velocity dies with it.
      if (m.at < -0.02) {
        m.at = -0.02;
        m.vel = 0;
      } else if (m.at > 1.06) {
        m.at = 1.06;
        m.vel = 0;
      }

      m.lamp = m.at >= OVER ? S.meterPeak : Math.max(0, m.lamp - dt);
    }
  }

  /**
   * A brass mounting screw.
   *
   * The thing that makes one of these read as hardware rather than as a circle
   * with a line through it is that every part of it is lit from the *same*
   * direction — and the first version got that wrong in a way that is obvious
   * once seen: it rotated the canvas to draw the slot, so the lit edge of the
   * groove rotated with it. Every screw ended up lit from wherever its own slot
   * happened to point.
   *
   * So the light is a fixed world direction here, and the groove works out
   * which of its two walls faces it. Rotate a screw and the bright wall swaps
   * sides on its own, which is exactly what a real one does.
   *
   * The rest is what a shallow dome does under a single source: a small hard
   * specular up toward the light rather than a wash across the middle, a
   * chamfer that is bright on the lit side and dark opposite, a thin bounce
   * along the shadow rim where the panel throws a little back, and a cast
   * shadow offset away from the light.
   */
  function screw(cx: number, cy: number, r: number, angle: number) {
    const lx = Math.cos(LIGHT);
    const ly = Math.sin(LIGHT);

    ctx.save();

    // Cast shadow, thrown away from the light and softened by distance.
    const cast = ctx.createRadialGradient(
      cx - lx * r * 0.28,
      cy - ly * r * 0.28,
      r * 0.2,
      cx - lx * r * 0.28,
      cy - ly * r * 0.28,
      r * 1.5,
    );
    cast.addColorStop(0, "rgba(0,0,0,0.55)");
    cast.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = cast;
    ctx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);

    // The countersink the head sits down inside.
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.13, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fill();

    // The head. Body tone shifted toward the light, so the far side falls off
    // before the chamfer is even drawn.
    const body = ctx.createLinearGradient(
      cx + lx * r,
      cy + ly * r,
      cx - lx * r,
      cy - ly * r,
    );
    body.addColorStop(0, BRASS[1]);
    body.addColorStop(0.55, BRASS[2]);
    body.addColorStop(1, BRASS[3]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();

    // The chamfer around the rim: lit side bright, opposite side nearly gone.
    const chamfer = ctx.createLinearGradient(
      cx + lx * r,
      cy + ly * r,
      cx - lx * r,
      cy - ly * r,
    );
    chamfer.addColorStop(0, BRASS[0]);
    chamfer.addColorStop(0.4, BRASS[2]);
    chamfer.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.lineWidth = Math.max(0.6, r * 0.2);
    ctx.strokeStyle = chamfer;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
    ctx.stroke();

    // Bounce along the shadow rim. Metal is never black on its dark side —
    // it picks the panel back up, and leaving that out is what makes brass
    // look like painted card.
    ctx.lineWidth = Math.max(0.5, r * 0.09);
    ctx.strokeStyle = "rgba(255,226,150,0.28)";
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.93, LIGHT + Math.PI * 0.55, LIGHT + Math.PI * 1.45);
    ctx.stroke();

    // --- the slot ----------------------------------------------------------
    // Cut, not drawn on. The walls are lit by how much each one faces the key.
    // The inner face of the wall drawn below the trough. Rotating the screw
    // swings this around with it, so which wall is lit falls out of the angle
    // instead of being baked in — checked against the physical case at eight
    // angles, because getting the sign backwards here looks almost right and
    // is the exact thing that made the first version read as a drawing.
    const nx = Math.sin(angle);
    const ny = -Math.cos(angle);
    const facing = nx * lx + ny * ly;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    const half = r * 0.16;

    // The trough itself.
    ctx.fillStyle = "rgba(22,15,4,0.88)";
    ctx.fillRect(-r * 0.78, -half, r * 1.56, half * 2);

    // Its two long walls. One catches the light, the other cannot, and which is
    // which falls out of the angle rather than being decided in advance.
    const wall = Math.max(0, facing);
    const back = Math.max(0, -facing);
    ctx.fillStyle = `rgba(255,238,180,${0.45 * wall})`;
    ctx.fillRect(-r * 0.78, half - r * 0.05, r * 1.56, r * 0.05);
    ctx.fillStyle = `rgba(255,238,180,${0.45 * back})`;
    ctx.fillRect(-r * 0.78, -half, r * 1.56, r * 0.05);

    ctx.restore();

    // The specular: small, hard, and up toward the light. A dome puts it there
    // and nowhere near the middle, which is where a plain radial fill puts it.
    const spec = ctx.createRadialGradient(
      cx + lx * r * 0.42,
      cy + ly * r * 0.42,
      0,
      cx + lx * r * 0.42,
      cy + ly * r * 0.42,
      r * 0.5,
    );
    spec.addColorStop(0, "rgba(255,250,225,0.9)");
    spec.addColorStop(0.5, "rgba(255,240,190,0.25)");
    spec.addColorStop(1, "rgba(255,240,190,0)");
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /** One instrument, drawn into the box it has been given. */
  function face(x: number, y: number, w: number, h: number, m: Needle) {
    const S = settings();

    const bulb = lamp();
    const pad = Math.min(w, h) * 0.06;
    const fx = x + pad;
    const fy = y + pad;
    const fw = w - pad * 2;
    const fh = h - pad * 2;

    // The pivot sits below the face, the way it does in the real instrument —
    // what you see is the top of an arc whose centre is behind the bezel.
    const px = fx + fw / 2;
    const py = fy + fh * 0.93;
    const R = Math.min(fh * 0.78, fw * 0.52);

    const angle = (at: number) => -Math.PI / 2 + (at * 2 - 1) * SWEEP;
    const on = (at: number, r: number) => {
      const a = angle(at);
      return [px + Math.cos(a) * r, py + Math.sin(a) * r] as const;
    };

    ctx.save();

    // --- the plate ---------------------------------------------------------
    //
    // The unlit face darkens as the backlight comes up, which sounds backwards
    // and is the only way this works. Ivory is already within a few percent of
    // white, so light added to it has nowhere to go: the pools clip flat and
    // the dial looks like a white rectangle rather than a lit one. Dropping the
    // ambient gives the lamp room, and it is also just true — you only ever see
    // a backlight in a room dim enough to have stopped lighting the face for it.
    const dim = 1 - clamp(S.meterGlow, 0, 1) * 0.58;
    const shade = (c: [number, number, number]) =>
      rgb([
        Math.round(c[0] * dim),
        Math.round(c[1] * dim),
        Math.round(c[2] * dim),
      ]);

    const plate = ctx.createLinearGradient(0, fy, 0, fy + fh);
    plate.addColorStop(0, shade([251, 246, 234]));
    plate.addColorStop(0.55, shade(parseRgb(IVORY)));
    plate.addColorStop(1, shade([221, 210, 189]));
    ctx.fillStyle = plate;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(fx, fy, fw, fh, Math.min(fw, fh) * 0.05);
    } else {
      ctx.rect(fx, fy, fw, fh);
    }
    ctx.fill();

    // The backlight.
    //
    // It has to *add* light. Tinting the face — multiplying it toward the lamp
    // colour — is the obvious move and it is exactly wrong: it can only make
    // the dial darker, which is a gel taped over the glass rather than a bulb
    // behind it. Lit means brighter than it was.
    //
    // Two pools rather than one, low and to the sides, because that is where
    // the bulbs physically sit; then a flat wash over the top, because there is
    // a diffuser between them and the face and no real meter shows you two
    // discrete spots. The unevenness that survives is the whole look.
    if (S.meterGlow > 0) {
      ctx.save();
      ctx.clip();
      ctx.globalCompositeOperation = "lighter";

      for (const at of [0.27, 0.73]) {
        const lx = fx + fw * at;
        const ly = fy + fh * 0.9;
        const pool = ctx.createRadialGradient(lx, ly, 0, lx, ly, fw * 0.62);
        pool.addColorStop(0, rgb(bulb.hot, 0.38 * S.meterGlow));
        pool.addColorStop(0.45, rgb(bulb.base, 0.18 * S.meterGlow));
        pool.addColorStop(1, rgb(bulb.base, 0));
        ctx.fillStyle = pool;
        ctx.fillRect(fx, fy, fw, fh);
      }

      ctx.fillStyle = rgb(bulb.base, 0.12 * S.meterGlow);
      ctx.fillRect(fx, fy, fw, fh);
      ctx.restore();
    }

    // --- the scale ---------------------------------------------------------
    const arcR = R * 0.86;

    ctx.lineCap = "butt";
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, R * 0.012);
    ctx.beginPath();
    ctx.arc(px, py, arcR, angle(0), angle(1));
    ctx.stroke();

    // Everything past 0dB, in the hot end of the ramp. On a real face this is
    // red; here it is whatever the panel's ramp calls its top, so the two
    // instruments still look like the same device.
    ctx.strokeStyle = colours.full[Math.round(0.42 * 255)];
    ctx.lineWidth = Math.max(2, R * 0.05);
    ctx.beginPath();
    ctx.arc(px, py, arcR + R * 0.035, angle(OVER), angle(1));
    ctx.stroke();

    // Ticks. Long and labelled where the face is printed, short between, which
    // is what stops the scale reading as a row of identical marks.
    ctx.strokeStyle = INK;
    for (let i = 0; i < MARKS.length; i++) {
      const mark = MARKS[i];
      const [x0, y0] = on(mark.at, arcR);
      const [x1, y1] = on(mark.at, arcR - R * 0.1);
      ctx.lineWidth = Math.max(1, R * 0.018);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      const next = MARKS[i + 1];
      if (next) {
        const [mx0, my0] = on((mark.at + next.at) / 2, arcR);
        const [mx1, my1] = on((mark.at + next.at) / 2, arcR - R * 0.055);
        ctx.lineWidth = Math.max(1, R * 0.01);
        ctx.beginPath();
        ctx.moveTo(mx0, my0);
        ctx.lineTo(mx1, my1);
        ctx.stroke();
      }
    }

    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.max(7, R * 0.1)}px ${SANS}`;
    for (const mark of MARKS) {
      const [lx, ly] = on(mark.at, arcR - R * 0.19);
      ctx.fillText(mark.label, lx, ly);
    }

    ctx.font = `700 ${Math.max(8, R * 0.13)}px ${SANS}`;
    ctx.fillText("VU", px, py - R * 0.38);

    // --- the overload lamp -------------------------------------------------
    // Moved in under the top edge, since the corners belong to the screws now.
    // It is also the right place for it: on the dial, where you are already
    // looking, rather than out on the bezel where you are not.
    if (S.meterPeak > 0) {
      const lampR = Math.max(2.5, R * 0.045);
      const lx = px;
      const ly = fy + fh * 0.13;
      const lit = m.lamp > 0;

      ctx.beginPath();
      ctx.arc(lx, ly, lampR, 0, Math.PI * 2);
      ctx.fillStyle = lit
        ? colours.full[Math.round(0.42 * 255)]
        : "rgba(80,70,55,0.45)";
      ctx.fill();

      if (lit) {
        ctx.save();
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = 0.5;
        const halo = ctx.createRadialGradient(lx, ly, 0, lx, ly, lampR * 3.4);
        halo.addColorStop(0, colours.full[Math.round(0.42 * 255)]);
        halo.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = halo;
        ctx.fillRect(fx, fy, fw, fh);
        ctx.restore();
      }
    }

    // --- the needle --------------------------------------------------------
    const a = angle(clamp(m.at, -0.02, 1.06));
    const tipR = arcR + R * 0.03;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a + Math.PI / 2);

    // Drawn as a taper rather than a stroked line: a real needle is wide at
    // the boss and comes to a point, and that is visible at this size.
    ctx.beginPath();
    ctx.moveTo(-R * 0.016, 0);
    ctx.lineTo(R * 0.016, 0);
    ctx.lineTo(R * 0.004, -tipR);
    ctx.lineTo(-R * 0.004, -tipR);
    ctx.closePath();
    ctx.fillStyle = INK;
    ctx.fill();

    // The counterweight, on the far side of the pivot. It is why the needle
    // balances, and leaving it off is one of those absences you feel.
    ctx.beginPath();
    ctx.moveTo(-R * 0.02, 0);
    ctx.lineTo(R * 0.02, 0);
    ctx.lineTo(R * 0.028, R * 0.13);
    ctx.lineTo(-R * 0.028, R * 0.13);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // The boss over the top of both.
    const boss = ctx.createLinearGradient(px, py - R * 0.06, px, py + R * 0.06);
    boss.addColorStop(0, "#4a423a");
    boss.addColorStop(1, "#191512");
    ctx.beginPath();
    ctx.arc(px, py, R * 0.055, 0, Math.PI * 2);
    ctx.fillStyle = boss;
    ctx.fill();

    // --- the glass ---------------------------------------------------------
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(fx, fy, fw, fh, Math.min(fw, fh) * 0.05);
    } else {
      ctx.rect(fx, fy, fw, fh);
    }
    ctx.clip();
    const sheen = ctx.createLinearGradient(fx, fy, fx + fw * 0.75, fy + fh);
    sheen.addColorStop(0, "rgba(255,255,255,0.5)");
    sheen.addColorStop(0.35, "rgba(255,255,255,0.06)");
    sheen.addColorStop(0.36, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(fx, fy, fw, fh);
    ctx.restore();

    // --- the bezel ---------------------------------------------------------
    ctx.strokeStyle = "rgba(30,24,18,0.55)";
    ctx.lineWidth = Math.max(1, Math.min(fw, fh) * 0.008);
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(fx, fy, fw, fh, Math.min(fw, fh) * 0.05);
    } else {
      ctx.rect(fx, fy, fw, fh);
    }
    ctx.stroke();

    // Four of them, at the corners, each at its own angle.
    const sr = Math.max(1.6, Math.min(fw, fh) * 0.026);
    const inset = sr * 2.1;
    const corners: [number, number][] = [
      [fx + inset, fy + inset],
      [fx + fw - inset, fy + inset],
      [fx + inset, fy + fh - inset],
      [fx + fw - inset, fy + fh - inset],
    ];
    corners.forEach(([sx, sy], i) => {
      // Fixed per corner and per instrument, so they never line up with one
      // another and never move between frames.
      screw(sx, sy, sr, Math.sin((i + 1) * 12.9898 + x * 0.017) * Math.PI);
    });

    // A little light escaping past the bezel onto the fascia. Nothing seals
    // perfectly, and the leak is what stops the meter reading as a bright
    // rectangle pasted onto a photograph of a panel.
    if (S.meterGlow > 0) {
      ctx.globalCompositeOperation = "lighter";
      const leak = ctx.createRadialGradient(
        px,
        fy + fh * 0.5,
        Math.min(fw, fh) * 0.32,
        px,
        fy + fh * 0.5,
        Math.max(fw, fh) * 0.72,
      );
      leak.addColorStop(0, rgb(bulb.base, 0.16 * S.meterGlow));
      leak.addColorStop(1, rgb(bulb.base, 0));
      ctx.fillStyle = leak;
      ctx.fillRect(x, y, w, h);
    }

    ctx.restore();
  }

  function draw() {
    ctx.globalCompositeOperation = "source-over";
    if (pctx) {
      ctx.drawImage(panel, 0, 0, W, H);
    } else {
      ctx.fillStyle = "#bdb6a7";
      ctx.fillRect(0, 0, W, H);
    }

    const n = needles.length;
    const cw = W / n;
    for (let i = 0; i < n; i++) face(i * cw, 0, cw, H, needles[i]);
  }

  function frame(now: number) {
    if (!running) return;

    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    t += dt * (reduced ? 0.35 : 1);

    drive(reduced ? dt * 0.5 : dt);
    draw();

    raf = requestAnimationFrame(frame);
  }

  build();
  raf = requestAnimationFrame(frame);

  const ro = new ResizeObserver(() => build());
  ro.observe(host);

  // The needle count and the fascia are the two settings that are not simply
  // read on the frame that uses them: one owns how many instruments exist, the
  // other is a canvas painted once and blitted thereafter.
  let count = settings().meterCount;
  let fascia = settings().meterPanel;
  const unsubscribe = subscribeSettings(() => {
    const S = settings();

    if (S.meterCount !== count) {
      count = S.meterCount;
      fit();
    }

    if (S.meterPanel !== fascia) {
      fascia = S.meterPanel;
      brush();
    }
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

export default function VoltageMeter({
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

    return setup(host, canvas, ctx, micRef, ramp(theme));
  }, [micRef, theme]);

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
