"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_THEME, THEME_NAMES, type ThemeName } from "@/lib/palette";

/**
 * Every number the panel is tuned by, in one place and live.
 *
 * These were consts scattered through LedPanel.tsx and mic.ts, which is the
 * right place for a value you set once and the wrong place for a value you are
 * still deciding. They now live here and are read on the frame they are used —
 * `settings()` in the render loop, never captured in a closure — so moving a
 * slider on /admin is visible on the panel before the finger is off it.
 *
 * The defaults below are exactly what the constants were, so a fresh checkout
 * behaves identically to before this file existed. `reset` is therefore always
 * a way back to the tuning that shipped.
 *
 * State lives outside React because the consumer is a requestAnimationFrame
 * loop, not a component. React reads the same store through
 * `useSyncExternalStore`, so the dashboard re-renders and the panel doesn't.
 */

export type Settings = {
  // --- panel geometry ---
  pitch: number;
  bloom: number;

  // --- dynamics ---
  floor: number;
  punch: number;
  attack: number;
  release: number;

  // --- quiet ---
  shimmer: number;
  quietAt: number;

  // --- peak markers ---
  peakHold: number;
  peakFall: number;

  // --- microphone ---
  fMin: number;
  fMax: number;
  noiseGate: number;
  minDb: number;
  maxDb: number;

  // --- auto-gain ---
  agcUp: number;
  agcDown: number;
  agcRoom: number;
  agcFloor: number;

  // --- spectral tilt ---
  tiltStrength: number;
  tiltMin: number;
  tiltMax: number;
  tiltTrack: number;

  // --- wordmark ---
  wordmark: boolean;
  spectrumMs: number;
  wipeMs: number;
  holdMs: number;

  // --- palette ---
  theme: ThemeName;
};

export const DEFAULTS: Settings = {
  pitch: 36,
  bloom: 0.72,

  floor: 0.08,
  punch: 2.1,
  attack: 34,
  release: 7.5,

  shimmer: 0.12,
  quietAt: 0.22,

  peakHold: 0.55,
  peakFall: 0.64,

  fMin: 45,
  fMax: 12_000,
  noiseGate: 0.055,
  minDb: -95,
  maxDb: -25,

  agcUp: 0.02,
  agcDown: 0.006,
  agcRoom: 1.8,
  agcFloor: 0.05,

  tiltStrength: 0.9,
  tiltMin: 0.6,
  tiltMax: 5,
  tiltTrack: 0.0015,

  wordmark: false,
  spectrumMs: 11_000,
  wipeMs: 900,
  holdMs: 3_600,

  theme: DEFAULT_THEME,
};

// --- what the dashboard draws -----------------------------------------------

type NumberField = {
  kind: "number";
  key: NumberKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** One line on what moving it does, and which way to move it. */
  note: string;
};

type ToggleField = {
  kind: "toggle";
  key: BooleanKey;
  label: string;
  note: string;
};

type ChoiceField = {
  kind: "choice";
  key: "theme";
  label: string;
  options: readonly string[];
  note: string;
};

export type Field = NumberField | ToggleField | ChoiceField;

export type Group = {
  title: string;
  /** Why these belong together, and what they trade against each other. */
  blurb: string;
  fields: Field[];
};

type KeysOfType<T> = {
  [K in keyof Settings]: Settings[K] extends T ? K : never;
}[keyof Settings];

export type NumberKey = KeysOfType<number>;
export type BooleanKey = KeysOfType<boolean>;

export const GROUPS: Group[] = [
  {
    title: "Panel",
    blurb:
      "How chunky the grid reads, and how hard the diodes bleed into the gaps between them.",
    fields: [
      {
        kind: "number",
        key: "pitch",
        label: "LED pitch",
        min: 16,
        max: 90,
        step: 1,
        note: "Centre-to-centre spacing in CSS px. Higher is chunkier, and takes steps off the amplitude scale with it.",
      },
      {
        kind: "number",
        key: "bloom",
        label: "Bloom",
        min: 0,
        max: 1.5,
        step: 0.02,
        note: "How much the blurred pass is added back over the panel. 0 is bare cells.",
      },
    ],
  },
  {
    title: "Dynamics",
    blurb:
      "The panel should be still in a quiet room and go off when there is sound. Most of the work is resisting the things that flatten that out.",
    fields: [
      {
        kind: "number",
        key: "punch",
        label: "Punch",
        min: 1,
        max: 4,
        step: 0.05,
        note: "Expansion over the whole range. Raise for more contrast, and for a panel that ignores more of what it can hear.",
      },
      {
        kind: "number",
        key: "floor",
        label: "Floor",
        min: 0,
        max: 0.3,
        step: 0.005,
        note: "Minimum drive on every column, so the bottom row never goes dark and the bars stand on a lit deck.",
      },
      {
        kind: "number",
        key: "attack",
        label: "Attack",
        min: 4,
        max: 80,
        step: 1,
        note: "How fast a bar rises to a new level. High is snappy; low smears transients.",
      },
      {
        kind: "number",
        key: "release",
        label: "Release",
        min: 1,
        max: 30,
        step: 0.5,
        note: "How fast it falls away. Must stay well under attack or a busy passage becomes one lit slab.",
      },
    ],
  },
  {
    title: "Peak markers",
    blurb:
      "The one part of the panel that reports history rather than now, and what makes a snare read as an event instead of a flicker.",
    fields: [
      {
        kind: "number",
        key: "peakHold",
        label: "Hold",
        min: 0,
        max: 3,
        step: 0.05,
        note: "Seconds a marker parks at a new high before it starts to sink.",
      },
      {
        kind: "number",
        key: "peakFall",
        label: "Fall",
        min: 0.05,
        max: 4,
        step: 0.02,
        note: "Then this much of the panel's height per second. Well under the bar's own fall, or it is never seen.",
      },
    ],
  },
  {
    title: "Quiet",
    blurb:
      "A silent room would pin every column to the same height, which looks less like a quiet panel than a broken one.",
    fields: [
      {
        kind: "number",
        key: "shimmer",
        label: "Shimmer",
        min: 0,
        max: 0.5,
        step: 0.005,
        note: "How far the idle wander lifts off the deck. A row or two; more and the rest is no longer rest.",
      },
      {
        kind: "number",
        key: "quietAt",
        label: "Quiet threshold",
        min: 0,
        max: 1,
        step: 0.01,
        note: "Signal below this counts as a quiet room, and the wander fades in to fill it.",
      },
    ],
  },
  {
    title: "Microphone",
    blurb:
      "The window the spectrum is stretched across, and what the panel refuses to hear at all. These two pull against each other.",
    fields: [
      {
        kind: "number",
        key: "minDb",
        label: "Min dB",
        min: -140,
        max: -40,
        step: 1,
        note: "Bottom of the window. Lower hears more of the room, and more of its hiss.",
      },
      {
        kind: "number",
        key: "maxDb",
        label: "Max dB",
        min: -60,
        max: 0,
        step: 1,
        note: "Top of the window. Well under a loud speaker, so the panel is moving at conversation level.",
      },
      {
        kind: "number",
        key: "noiseGate",
        label: "Noise gate",
        min: 0,
        max: 0.3,
        step: 0.005,
        note: "Anything under this is room hiss, not signal. High enough that an empty room reads as empty.",
      },
      {
        kind: "number",
        key: "fMin",
        label: "Low edge (Hz)",
        min: 20,
        max: 300,
        step: 5,
        note: "Leftmost column. Below ~45Hz is mostly rumble.",
      },
      {
        kind: "number",
        key: "fMax",
        label: "High edge (Hz)",
        min: 2_000,
        max: 20_000,
        step: 250,
        note: "Rightmost column. Above ~12kHz there is rarely enough energy to move a bar.",
      },
    ],
  },
  {
    title: "Auto-gain",
    blurb:
      "One number divides the whole panel, so what it is measured from decides whether a rhythm reads as a rhythm. It is the mean across the panel, never the loudest column.",
    fields: [
      {
        kind: "number",
        key: "agcRoom",
        label: "Room headroom",
        min: 0.5,
        max: 5,
        step: 0.05,
        note: "Where ordinary content sits. Lower pins the panel, higher flattens it.",
      },
      {
        kind: "number",
        key: "agcFloor",
        label: "Gain floor",
        min: 0.005,
        max: 0.4,
        step: 0.005,
        note: "Smallest reference the gain will divide by, so near-silence is not hauled up to full scale.",
      },
      {
        kind: "number",
        key: "agcUp",
        label: "Follow up",
        min: 0.001,
        max: 0.2,
        step: 0.001,
        note: "How fast the reference follows a rise. Under a second at the default.",
      },
      {
        kind: "number",
        key: "agcDown",
        label: "Follow down",
        min: 0.001,
        max: 0.2,
        step: 0.001,
        note: "And back down — slower, or the fade after a loud passage reads as pumping.",
      },
    ],
  },
  {
    title: "Spectral tilt",
    blurb:
      "Music has far more energy at the bottom than the top. This corrects the standing shape of the spectrum without touching the dynamics, which is why the treble can dance as hard as the bass.",
    fields: [
      {
        kind: "number",
        key: "tiltStrength",
        label: "Strength",
        min: 0,
        max: 1,
        step: 0.02,
        note: "At 1 every column averages the same height and the panel is ruled flat. Just under leaves some natural bass lean.",
      },
      {
        kind: "number",
        key: "tiltTrack",
        label: "Tracking",
        min: 0.0002,
        max: 0.02,
        step: 0.0002,
        note: "How fast the per-column average follows. Too fast and it cancels the beat it was meant to show.",
      },
      {
        kind: "number",
        key: "tiltMin",
        label: "Most pulled down",
        min: 0.1,
        max: 1,
        step: 0.05,
        note: "Floor on the correction applied to a loud column.",
      },
      {
        kind: "number",
        key: "tiltMax",
        label: "Most pushed up",
        min: 1,
        max: 12,
        step: 0.25,
        note: "Ceiling on the correction applied to a quiet one.",
      },
    ],
  },
  {
    title: "Wordmark",
    blurb:
      "PETRU rasterised into the grid, with a horizontal wipe handing columns over to it. Parked by default — the panel runs pure spectrum.",
    fields: [
      {
        kind: "toggle",
        key: "wordmark",
        label: "Show wordmark",
        note: "Restores the analyser → PETRU → analyser cycle.",
      },
      {
        kind: "number",
        key: "spectrumMs",
        label: "Spectrum (ms)",
        min: 1_000,
        max: 40_000,
        step: 500,
        note: "How long the analyser runs before the wipe.",
      },
      {
        kind: "number",
        key: "wipeMs",
        label: "Wipe (ms)",
        min: 100,
        max: 4_000,
        step: 50,
        note: "How long the write head takes to cross the panel.",
      },
      {
        kind: "number",
        key: "holdMs",
        label: "Hold (ms)",
        min: 200,
        max: 20_000,
        step: 100,
        note: "How long the wordmark stays up before wiping back.",
      },
    ],
  },
  {
    title: "Palette",
    blurb:
      "One ramp, bottom row to top. A column's top LED is both its level and its colour, so the band is the scale printed beside the meter.",
    fields: [
      {
        kind: "choice",
        key: "theme",
        label: "Ramp",
        options: THEME_NAMES,
        note: "`?theme=` in the URL still overrides this at load.",
      },
    ],
  },
];

// --- the store ---------------------------------------------------------------

const KEY = "petru.settings";

let current: Settings = { ...DEFAULTS };

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

/**
 * The live settings, for code that runs outside React.
 *
 * Call it *inside* the frame rather than hoisting the result: the object is
 * replaced on every change, and a reference captured when the panel was set up
 * would go on describing the tuning it started with.
 */
export function settings() {
  return current;
}

export function subscribeSettings(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

/** Drop anything unrecognised, so an old or hand-edited blob can't poison the panel. */
function clean(input: unknown): Partial<Settings> {
  if (!input || typeof input !== "object") return {};

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const expected = DEFAULTS[key as keyof Settings];
    if (expected === undefined) continue;

    if (typeof expected === "number") {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    } else if (typeof expected === "boolean") {
      if (typeof value === "boolean") out[key] = value;
    } else if (key === "theme") {
      if (typeof value === "string" && (THEME_NAMES as string[]).includes(value)) {
        out[key] = value;
      }
    }
  }

  return out as Partial<Settings>;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode, or a full quota. The settings still work for this session.
  }
}

/** Apply without echoing back out, for changes that arrived from another tab. */
function adopt(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  notify();
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  if (current[key] === value) return;

  current = { ...current, [key]: value };
  persist();
  channel?.postMessage({ [key]: value });
  notify();
}

export function resetSettings() {
  current = { ...DEFAULTS };
  persist();
  channel?.postMessage(DEFAULTS);
  notify();
}

if (typeof window !== "undefined") {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) current = { ...current, ...clean(JSON.parse(stored)) };
  } catch {
    // Unparseable. Defaults it is.
  }

  // So the dashboard can sit in one window and the panel in another, on a
  // second screen, and the sliders still drive it.
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel(KEY);
    channel.addEventListener("message", (event) => adopt(clean(event.data)));
  }
}

// --- React ------------------------------------------------------------------

/**
 * Server-rendered markup is always the defaults, because localStorage does not
 * exist there; the store syncs on the client immediately after.
 */
export function useSettings() {
  const value = useSyncExternalStore(
    subscribeSettings,
    settings,
    () => DEFAULTS,
  );

  const set = useCallback(
    <K extends keyof Settings>(key: K, next: Settings[K]) =>
      setSetting(key, next),
    [],
  );

  return { settings: value, set, reset: resetSettings };
}
