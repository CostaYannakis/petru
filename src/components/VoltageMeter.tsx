"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { MicSource } from "@/lib/mic";
import { DEFAULT_THEME, ramp, type Ramp, type ThemeName } from "@/lib/palette";
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

const IVORY = "#efe7d6";
const INK = "#171310";

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

    fit();
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

  /** One instrument, drawn into the box it has been given. */
  function face(x: number, y: number, w: number, h: number, m: Needle) {
    const S = settings();

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
    const plate = ctx.createLinearGradient(0, fy, 0, fy + fh);
    plate.addColorStop(0, "#fbf6ea");
    plate.addColorStop(0.55, IVORY);
    plate.addColorStop(1, "#ddd2bd");
    ctx.fillStyle = plate;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(fx, fy, fw, fh, Math.min(fw, fh) * 0.05);
    } else {
      ctx.rect(fx, fy, fw, fh);
    }
    ctx.fill();

    // The lamp behind the dial, pooling up from the bottom where the bulb is.
    if (S.meterGlow > 0) {
      ctx.save();
      ctx.clip();
      const lamp = ctx.createRadialGradient(px, py, 0, px, py, R * 1.5);
      lamp.addColorStop(0, colours.full[Math.round(0.72 * 255)]);
      lamp.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = S.meterGlow * 0.5;
      ctx.fillStyle = lamp;
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
    if (S.meterPeak > 0) {
      const lampR = Math.max(2.5, R * 0.045);
      const lx = fx + fw - lampR * 3.2;
      const ly = fy + lampR * 3.2;
      const lit = m.lamp > 0;

      ctx.beginPath();
      ctx.arc(lx, ly, lampR, 0, Math.PI * 2);
      ctx.fillStyle = lit ? colours.full[Math.round(0.42 * 255)] : "#b9ae99";
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

    ctx.restore();
  }

  function draw() {
    // The surround is the brushed panel the instruments are set into, which is
    // the one part of this that is allowed to be nearly white.
    const back = ctx.createLinearGradient(0, 0, 0, H);
    back.addColorStop(0, "#e9e3d6");
    back.addColorStop(1, "#cfc6b4");
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, W, H);

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

  let count = settings().meterCount;
  const unsubscribe = subscribeSettings(() => {
    const next = settings().meterCount;
    if (next === count) return;
    count = next;
    fit();
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
