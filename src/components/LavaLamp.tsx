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
import { settings, subscribeSettings } from "@/lib/settings-store";

/**
 * The other screen: a lava lamp that listens.
 *
 * The panel is a meter — it reports a level, honestly, sixty times a second.
 * This is the opposite instrument. Nothing here maps a number to a height.
 * Sound heats the floor of the lamp, and everything after that happens because
 * of buoyancy, drag and surface tension. A bass note does not move a blob; it
 * warms the fluid, and a blob that was already going to rise rises sooner.
 *
 * That indirection is the whole effect. It is why the thing stays hypnotic
 * across a track rather than twitching along with it, and why it never quite
 * repeats: the room keeps changing how hard the floor is driven, and the fluid
 * is always still answering the last thing it was told.
 *
 * Blobs are drawn as plain circles and then run through blur and a hard
 * contrast — the metaball trick. Blur bleeds neighbours into one another and
 * contrast snaps the result back to an edge, so two blobs that drift close
 * form one shape with a proper neck between them, and part again with the same
 * reluctance. Done on opaque black rather than a transparent surface, because
 * contrast on RGB is well defined everywhere and contrast on alpha is not.
 *
 * Colour comes from the same ramp as the panel, mapped bottom to top, so the
 * two screens are recognisably the same device.
 */

/** Bands read from the microphone. Enough to split three ways, no more. */
const BANDS = 24;

/** The fluid is rendered at half resolution — it is all soft edges anyway. */
const SCALE = 0.5;

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

type Blob = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0 is cold and sinking, 1 is hot and climbing. */
  heat: number;
  /** Size relative to the others, fixed for the life of the blob. */
  scale: number;
  /** Fixed phase, so no two wander alike. */
  seed: number;
};

function setup(
  host: HTMLDivElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  micRef: RefObject<MicSource | null>,
  colours: Ramp,
) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Where the blobs are drawn, where they are melted together, and where the
  // glow inside them is built.
  const field = document.createElement("canvas");
  const fctx = field.getContext("2d", { alpha: false });
  const goo = document.createElement("canvas");
  const gctx = goo.getContext("2d", { alpha: false });
  const core = document.createElement("canvas");
  const cctx = core.getContext("2d", { alpha: false });
  const canBlur = typeof ctx.filter === "string";

  let W = 0;
  let H = 0;
  let fw = 0;
  let fh = 0;
  let dpr = 1;

  const bands = new Float32Array(BANDS);
  let blobs: Blob[] = [];

  // Smoothed energies. The lamp answers the shape of the last half second and
  // not individual frames — one that flinched at every hi-hat would be a strobe
  // with extra steps.
  let bass = 0;
  let treble = 0;
  let level = 0;

  /**
   * Bass measured again, much more slowly, purely to have something to compare
   * the fast reading against. Heat is the right model for the *shape* of a
   * track and hopeless for its *rhythm*: thermal mass is exactly the property
   * that stops a beat arriving, so a kick warms the fluid and is gone before
   * anything visibly moves. `pulse` is the difference between the two readings
   * — how much louder the bass is right now than it has been — and that is what
   * a transient actually is.
   */
  let bassSlow = 0;
  let pulse = 0;
  /** Last frame's, so the *rising edge* can be told from the ringing tail. */
  let prevPulse = 0;

  let t = 0;
  let raf = 0;
  let last = 0;
  let running = true;

/**
 * Two points on the ramp, and only two.
 *
 * The first version coloured the fluid by height, straight off the panel's
 * ramp, which is right for a meter and wrong for a lamp: it painted a rainbow
 * up the glass and made every blob change colour as it drifted, which reads as
 * a gradient with blobs in front of it rather than as wax.
 *
 * A lamp is one substance, lit from behind — a body colour and a hotter middle
 * where more of it is stacked up. So the ramp is sampled at exactly two points:
 * low for the wax, high for the glow inside it. The panel's identity survives,
 * because those two points still come from its ramp — neon gives red wax with a
 * yellow core, ice gives teal and pale white, ember amber and gold.
 */
const WAX = 0.32;
const GLOW = 0.78;

  function seed() {
    const { lavaBlobs } = settings();
    const next: Blob[] = [];

    for (let i = 0; i < lavaBlobs; i++) {
      // Existing blobs are kept, so changing the count on the bench adds and
      // removes them rather than restarting the lamp.
      next.push(
        blobs[i] ?? {
          x: (0.15 + Math.random() * 0.7) * W,
          y: (0.2 + Math.random() * 0.75) * H,
          vx: 0,
          vy: 0,
          heat: Math.random(),
          scale: 0.6 + Math.random() * 0.8,
          seed: Math.random() * Math.PI * 2,
        },
      );
    }

    blobs = next;
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

    fw = Math.max(1, Math.round(W * SCALE));
    fh = Math.max(1, Math.round(H * SCALE));
    field.width = fw;
    field.height = fh;
    goo.width = fw;
    goo.height = fh;
    core.width = fw;
    core.height = fh;

    seed();
  }

  /**
   * The lamp with nothing coming in. Not silence — a real lamp convects whether
   * or not anyone is in the room, so this is a slow breath rather than a beat,
   * and the physics does the rest.
   */
  function idle() {
    const breath = 0.5 + 0.5 * Math.sin(t * 0.21);
    bass += (0.18 + breath * 0.16 - bass) * 0.02;
    treble += (0.06 - treble) * 0.02;
    level += (0.16 - level) * 0.02;
    bassSlow += (bass - bassSlow) * 0.01;
    pulse *= 0.94;
  }

  function listen() {
    const mic = micRef.current;
    if (!mic) {
      idle();
      return;
    }

    mic.read(bands);

    // Three ranges, weighted the way they matter here: the bottom third is the
    // bulb, the top is surface detail, the whole thing is how full the lamp is.
    let low = 0;
    let high = 0;
    let all = 0;
    const cut = Math.max(1, Math.floor(BANDS / 3));

    for (let i = 0; i < BANDS; i++) {
      all += bands[i];
      if (i < cut) low += bands[i];
      else if (i >= BANDS - cut) high += bands[i];
    }

    low /= cut;
    high /= cut;
    all /= BANDS;

    // Rises quickly, falls slowly. Heat has thermal mass; so should this.
    // Fast enough to see a kick arrive, and a slow twin to measure it against.
    bass += (low - bass) * (low > bass ? 0.35 : 0.06);
    treble += (high - treble) * (high > treble ? 0.3 : 0.08);
    level += (all - level) * (all > level ? 0.12 : 0.03);
    bassSlow += (low - bassSlow) * 0.012;

    // Only the excess counts. Steady loud bass raises the slow reading with it
    // and stops registering, which is right — a held note is not an event.
    const over = bass - bassSlow * 1.25 - 0.02;
    const hit = over > 0 ? clamp(over * 5, 0, 1) : 0;

    // Snap up, ring out. The decay is what turns an instant into a swell that
    // the fluid has time to answer.
    pulse = hit > pulse ? hit : pulse + (hit - pulse) * 0.08;
  }

  function step(dt: number) {
    const S = settings();
    if (blobs.length !== S.lavaBlobs) seed();

    // One reading per frame, shared by every blob: how much of this frame's
    // pulse is new. The tail is already accounted for in the fluid's motion.
    const onset = Math.max(0, pulse - prevPulse);
    prevPulse = pulse;

    const base = Math.min(W, H) * S.lavaSize;

    // Frame-rate independent drag: viscosity is quoted per sixtieth of a
    // second, so a slow frame thickens the fluid rather than teleporting
    // through it.
    const drag = Math.pow(S.lavaViscosity, dt * 60);

    // The bulb. Bass warms the floor, and the pulse flares it — a kick is a
    // burst from the element rather than a steady rise in its temperature.
    const bulb = 0.28 + (bass + pulse * 1.6) * S.lavaHeat;

    for (const b of blobs) {
      const r = base * b.scale;

      // Near the floor it takes on heat, near the ceiling it gives it up. That
      // one rule is the entire circulation — everything rises, cools, falls,
      // warms and rises again.
      const fromFloor = clamp((b.y - (H - r * 2.4)) / (r * 2.4), 0, 1);
      const fromRoof = clamp((r * 2.4 - b.y) / (r * 2.4), 0, 1);

      b.heat += fromFloor * bulb * dt * 1.15;
      b.heat -= fromRoof * dt * 0.85;
      b.heat -= dt * 0.12; // and a little to the fluid all the way up
      b.heat = clamp(b.heat, 0, 1);

      // The kick itself, felt through the fluid rather than at the element.
      //
      // Applied to velocity directly, on the rising edge only. Spreading it
      // across the pulse as an acceleration is what the first version did, and
      // it does nothing: at a viscosity worth having, drag has eaten ninety-odd
      // percent of it within a fifth of a second, so the force is gone long
      // before it has displaced anything you could see.
      //
      // Modest on purpose. A harder shove is not better — it launches blobs
      // into the ceiling, where they stick, and a lamp with everything piled at
      // the top has stopped being a lamp.
      //
      // Weighted toward the bottom, so a beat lifts what is sitting on the
      // floor and merely nudges what is already halfway up: a swell travelling
      // upward rather than the whole picture jumping at once.
      if (onset > 0.05) {
        const low = clamp(b.y / H, 0, 1);
        b.vy -= onset * S.lavaKick * 900 * (0.35 + low * 0.65);
        b.heat += onset * S.lavaKick * 0.18 * low;

        // And a shove sideways, whose direction is fixed per blob. Lateral
        // motion reads as strongly as vertical and cannot pile anything up —
        // the glass is right there to stop it.
        b.vx += Math.sin(b.seed * 3.7) * onset * S.lavaKick * 460;
      }

      // Buoyancy against weight, balanced so a blob at half heat is very nearly
      // neutral and simply drifts. That is where the lamp spends most of its
      // time and where it looks best.
      b.vy -= (b.heat - 0.5) * S.lavaBuoyancy * 620 * dt;
      b.vy += 46 * dt;

      // Sideways wander on two incommensurate rates off a fixed seed, so no two
      // blobs ever quite agree and the pattern never comes round again.
      b.vx +=
        (Math.sin(t * 0.37 + b.seed) * 0.6 +
          Math.sin(t * 0.19 + b.seed * 2.3) * 0.4) *
        26 *
        dt;

      // Treble is surface detail, so it goes in sideways and fast. It never
      // lifts anything — the lamp would stop reading as gravity-bound if the
      // top end could push things up.
      b.vx +=
        Math.sin(t * 5.3 + b.seed * 3.1) * treble * 240 * S.lavaKick * dt;

      b.vx *= drag;
      b.vy *= drag;

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // Glass. A soft landing, because a lamp's blobs flatten against the wall
      // and slide rather than rebounding off it.
      if (b.x < r * 0.55) {
        b.x = r * 0.55;
        b.vx = Math.abs(b.vx) * 0.3;
      } else if (b.x > W - r * 0.55) {
        b.x = W - r * 0.55;
        b.vx = -Math.abs(b.vx) * 0.3;
      }

      if (b.y < r * 0.5) {
        b.y = r * 0.5;
        b.vy = Math.abs(b.vy) * 0.25;
      } else if (b.y > H - r * 0.5) {
        b.y = H - r * 0.5;
        b.vy = -Math.abs(b.vy) * 0.25;
      }
    }

    // Surface tension: a gentle pull at conversation distance, a firm push once
    // they are inside each other. Blobs that meet hang together a while and
    // then let go, which is the behaviour worth having — a lamp where they
    // either bounce or merge forever looks like neither.
    for (let i = 0; i < blobs.length; i++) {
      const a = blobs[i];
      const ra = base * a.scale;

      for (let j = i + 1; j < blobs.length; j++) {
        const c = blobs[j];
        const rc = base * c.scale;

        let dx = c.x - a.x;
        let dy = c.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-4) continue;

        const d = Math.sqrt(d2);
        const touch = (ra + rc) * 0.82;
        const reach = (ra + rc) * 1.9;
        if (d > reach) continue;

        dx /= d;
        dy /= d;

        const force =
          d < touch
            ? -((touch - d) / touch) * 900 // push apart
            : ((reach - d) / reach) * 70; // draw together

        a.vx += dx * force * dt;
        a.vy += dy * force * dt;
        c.vx -= dx * force * dt;
        c.vy -= dy * force * dt;
      }
    }
  }

  function draw() {
    const S = settings();
    if (!fctx || !gctx || !cctx) return;

    const base = Math.min(W, H) * S.lavaSize;

    // --- the blobs, plain and separate --------------------------------------
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.fillStyle = "#000";
    fctx.fillRect(0, 0, fw, fh);
    fctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    fctx.fillStyle = "#fff";

    for (const b of blobs) {
      // The swell is where the beat actually shows.
      //
      // Travel is the obvious place to put it and the wrong one: the fluid is
      // viscous by design, so a blob simply cannot move far in the fifth of a
      // second a kick lasts, and pushing hard enough to make it move that far
      // costs the lamp its circulation. Size has no such problem. It answers
      // instantly, it is bounded, and it cannot destabilise anything — the
      // physics keeps using the unswollen radius, so this is purely what you
      // see, not what the blobs do to each other.
      //
      // It also does the best thing in the picture for free: swelling blobs
      // meet, so necks form and break on the beat through the merge threshold.
      const r =
        base * b.scale * (1 + pulse * 0.35 + level * 0.1 + treble * 0.05);

      // Squash and stretch along the direction of travel, plus a share of the
      // pulse — a real fluid deforms when it is struck, not only when it moves.
      const speed = Math.hypot(b.vx, b.vy);
      const s = clamp(speed / 420 + pulse * 0.12, 0, 0.42);

      fctx.save();
      fctx.translate(b.x, b.y);
      if (s > 0.01) {
        fctx.rotate(Math.atan2(b.vy, b.vx));
        fctx.scale(1 + s, 1 - s * 0.62);
      }
      fctx.beginPath();
      fctx.arc(0, 0, r, 0, Math.PI * 2);
      fctx.fill();
      fctx.restore();
    }

    // A pool of heat at the base, so the bulb is visibly where the sound goes
    // in rather than an invisible rule the blobs obey.
    const glow = fctx.createRadialGradient(W / 2, H, 0, W / 2, H, H * 0.42);
    const heat = clamp(0.1 + (bass + pulse * 1.4) * S.lavaHeat * 0.5, 0, 0.9);
    glow.addColorStop(0, `rgba(255,255,255,${heat})`);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    fctx.fillStyle = glow;
    fctx.fillRect(0, 0, W, H);

    // --- melt them together --------------------------------------------------
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.globalCompositeOperation = "source-over";

    if (canBlur) {
      // The threshold tightens on a hit, so the mass draws itself in and its
      // necks snap taut on the beat. Cheap, and it moves the whole silhouette
      // at once rather than one blob at a time.
      const bite = S.lavaGoo * (1 + pulse * 0.5);
      gctx.filter = `blur(${Math.max(2, base * SCALE * 0.34)}px) contrast(${bite})`;
    }
    gctx.drawImage(field, 0, 0);
    gctx.filter = "none";

    // The wax. A flat colour low on the ramp, multiplied through the hard
    // silhouette so black stays black and the shape takes one colour — a lamp
    // is one substance, not a gradient.
    gctx.globalCompositeOperation = "multiply";
    gctx.fillStyle = colours.body[Math.round(WAX * 255)];
    gctx.fillRect(0, 0, fw, fh);
    gctx.globalCompositeOperation = "source-over";

    // The glow inside it. The same blobs blurred but *not* thresholded, so the
    // brightness is a genuine thickness map: one blob is warm in the middle,
    // and two lying across each other are brighter still where they overlap.
    // That is the whole reason a lava lamp looks lit rather than painted, and
    // it comes free from not throwing the soft edges away.
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.globalCompositeOperation = "source-over";
    if (canBlur) {
      cctx.filter = `blur(${Math.max(2, base * SCALE * 0.22)}px)`;
    }
    cctx.drawImage(field, 0, 0);
    cctx.filter = "none";

    cctx.globalCompositeOperation = "multiply";
    // The core climbs the ramp as the room gets louder, so the lamp runs hotter
    // through a loud passage. Colour answers the music without any of it
    // becoming a chart.
    const glowAt = clamp(GLOW + (level * 0.1 + pulse * 0.12), 0, 1);
    cctx.fillStyle = colours.full[Math.round(glowAt * 255)];
    cctx.fillRect(0, 0, fw, fh);
    cctx.globalCompositeOperation = "source-over";

    // --- onto the glass -----------------------------------------------------
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = PANEL_BLACK;
    ctx.fillRect(0, 0, W, H);

    // Added rather than drawn over, so the black around the fluid contributes
    // nothing and the lamp appears to be lit from inside.
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(goo, 0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.drawImage(core, 0, 0, W, H);
    ctx.restore();

    if (canBlur) {
      ctx.save();
      ctx.filter = `blur(${Math.max(6, base * 0.3)}px)`;
      ctx.globalAlpha = clamp(S.bloom, 0, 1.5) * 0.5;
      ctx.drawImage(core, 0, 0, W, H);
      ctx.filter = "none";
      ctx.restore();
    }

    ctx.globalCompositeOperation = "source-over";
  }

  function frame(now: number) {
    if (!running) return;

    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    t += dt * (reduced ? 0.35 : 1);

    listen();
    step(reduced ? dt * 0.35 : dt);
    draw();

    raf = requestAnimationFrame(frame);
  }

  build();
  raf = requestAnimationFrame(frame);

  const ro = new ResizeObserver(() => build());
  ro.observe(host);

  // Only the blob count needs telling; everything else is read per frame.
  let count = settings().lavaBlobs;
  const unsubscribe = subscribeSettings(() => {
    const next = settings().lavaBlobs;
    if (next === count) return;
    count = next;
    seed();
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

export default function LavaLamp({
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
