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

  // Where the blobs are drawn, and where they are melted together.
  const field = document.createElement("canvas");
  const fctx = field.getContext("2d", { alpha: false });
  const goo = document.createElement("canvas");
  const gctx = goo.getContext("2d", { alpha: false });
  const canBlur = typeof ctx.filter === "string";

  let W = 0;
  let H = 0;
  let fw = 0;
  let fh = 0;
  let dpr = 1;
  let lava: CanvasGradient | null = null;

  const bands = new Float32Array(BANDS);
  let blobs: Blob[] = [];

  // Smoothed energies. The lamp answers the shape of the last half second and
  // not individual frames — one that flinched at every hi-hat would be a strobe
  // with extra steps.
  let bass = 0;
  let treble = 0;
  let level = 0;

  let t = 0;
  let raf = 0;
  let last = 0;
  let running = true;

  /**
   * The ramp as a vertical gradient, sampled from the same lookup table the LED
   * panel indexes per row — so a blob two thirds up is the colour a bar two
   * thirds up would be.
   */
  function buildGradient() {
    // Built on the context that paints it. A CanvasGradient is portable in
    // practice, but there is no reason to lean on that when the surface it
    // belongs to is right here.
    if (!gctx) return;

    const g = gctx.createLinearGradient(0, H, 0, 0);
    const stops = 10;
    for (let i = 0; i <= stops; i++) {
      const at = i / stops;
      g.addColorStop(at, colours.full[Math.round(at * 255)]);
    }
    lava = g;
  }

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

    buildGradient();
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
    bass += (low - bass) * (low > bass ? 0.12 : 0.03);
    treble += (high - treble) * (high > treble ? 0.2 : 0.06);
    level += (all - level) * (all > level ? 0.1 : 0.03);
  }

  function step(dt: number) {
    const S = settings();
    if (blobs.length !== S.lavaBlobs) seed();

    const base = Math.min(W, H) * S.lavaSize;

    // Frame-rate independent drag: viscosity is quoted per sixtieth of a
    // second, so a slow frame thickens the fluid rather than teleporting
    // through it.
    const drag = Math.pow(S.lavaViscosity, dt * 60);

    // The bulb. Sound is heat, and heat is the only thing sound does here.
    const bulb = 0.28 + bass * S.lavaHeat;

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
    if (!fctx || !gctx || !lava) return;

    const base = Math.min(W, H) * S.lavaSize;

    // --- the blobs, plain and separate --------------------------------------
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.fillStyle = "#000";
    fctx.fillRect(0, 0, fw, fh);
    fctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    fctx.fillStyle = "#fff";

    for (const b of blobs) {
      // Size answers the room a little, so the lamp swells on a loud passage.
      const r = base * b.scale * (1 + level * 0.12 + treble * 0.08);

      // Squash and stretch along the direction of travel. Real fluid does this,
      // and it is most of why the motion reads as heavy rather than floaty.
      const speed = Math.hypot(b.vx, b.vy);
      const s = clamp(speed / 420, 0, 0.34);

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
    const heat = clamp(0.1 + bass * S.lavaHeat * 0.5, 0, 0.85);
    glow.addColorStop(0, `rgba(255,255,255,${heat})`);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    fctx.fillStyle = glow;
    fctx.fillRect(0, 0, W, H);

    // --- melt them together --------------------------------------------------
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.globalCompositeOperation = "source-over";

    if (canBlur) {
      gctx.filter = `blur(${Math.max(2, base * SCALE * 0.34)}px) contrast(${S.lavaGoo})`;
    }
    gctx.drawImage(field, 0, 0);
    gctx.filter = "none";

    // White silhouette times the ramp: black stays black, and what is lit takes
    // its colour from how high up the lamp it sits.
    gctx.globalCompositeOperation = "multiply";
    gctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    gctx.fillStyle = lava;
    gctx.fillRect(0, 0, W, H);
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.globalCompositeOperation = "source-over";

    // --- onto the glass -----------------------------------------------------
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = PANEL_BLACK;
    ctx.fillRect(0, 0, W, H);

    // Added rather than drawn over, so the black around the fluid contributes
    // nothing and the lamp appears to be lit from inside.
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(goo, 0, 0, W, H);

    if (canBlur) {
      ctx.save();
      ctx.filter = `blur(${Math.max(6, base * 0.3)}px)`;
      ctx.globalAlpha = clamp(S.bloom, 0, 1.5) * 0.6;
      ctx.drawImage(goo, 0, 0, W, H);
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
