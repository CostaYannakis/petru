import { DEFAULT_THEME, THEME_NAMES, type ThemeName } from "@/lib/palette";

/**
 * The renderers, and what they are for.
 *
 * `panel` reports — every bar's height is a reading. `lava` is the opposite
 * instrument, where sound heats a fluid and physics does the rest. `meter` is a
 * needle with mass and a spring, which is a third thing again: it does not show
 * you the level, it shows you the level arriving. `nixie` is not a meter at
 * all — it tells the time, and only lets the room touch its brightness.
 *
 * They share the microphone, the ramp and the tap-anywhere, and know nothing
 * about each other.
 */
export const SCREENS = ["panel", "lava", "meter", "nixie"] as const;
export type ScreenName = (typeof SCREENS)[number];

/**
 * What the instruments are set into. Vantablack leaves them floating with
 * nothing around them but their own leaked light; brushed puts them in a
 * seventies fascia.
 */
export const METER_PANELS = ["vanta", "brushed"] as const;

/**
 * The bulbs.
 *
 * Real lamps behind a dial are incandescent — warm white — and the colour a
 * receiver is remembered by is the filter in front of them. These are those
 * filters. `ramp` is the odd one out: it takes the panel's own palette instead,
 * so the meter matches whatever the other two screens are wearing.
 */
/** What the tubes are mounted behind. */
export const NIXIE_PANELS = ["vanta", "brushed", "walnut"] as const;

export const METER_LAMPS = [
  "warm",
  "amber",
  "red",
  "blue",
  "green",
  "ramp",
] as const;

/**
 * Every number the panel is tuned by, and what each one is for.
 *
 * This half is pure data — the shape, the defaults, the bench's schema and the
 * validator. No React and no browser, so the route handlers can import it to
 * check what arrives over the wire against the same definitions the dashboard
 * draws from. The live store that reads and writes these lives next door in
 * settings-store.ts.
 *
 * These were consts scattered through LedPanel.tsx and mic.ts, which is the
 * right place for a value you set once and the wrong place for a value you are
 * still deciding. The defaults below are exactly what those constants were, so
 * a fresh checkout behaves identically to before this file existed, and reset
 * is always a way back to the tuning that shipped.
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

  // --- which screen ---
  screen: ScreenName;

  // --- lava lamp ---
  lavaBlobs: number;
  lavaViscosity: number;
  lavaBuoyancy: number;
  lavaHeat: number;
  lavaSize: number;
  lavaKick: number;
  lavaLight: boolean;
  lavaSheen: number;
  lavaGoo: number;

  // --- voltage meter ---
  meterCount: number;
  meterRise: number;
  meterDamping: number;
  meterGlow: number;
  meterPeak: number;
  meterPanel: (typeof METER_PANELS)[number];
  meterLamp: (typeof METER_LAMPS)[number];

  // --- nixie clock ---
  nixiePanel: (typeof NIXIE_PANELS)[number];
  nixieSeconds: boolean;
  nixie24: boolean;
  nixieGhost: number;
  nixieGlow: number;
  nixieFlicker: number;

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

  screen: "panel",
  lavaBlobs: 9,
  lavaViscosity: 0.9,
  lavaBuoyancy: 1,
  lavaHeat: 1,
  lavaSize: 0.14,
  lavaKick: 1,
  lavaLight: false,
  lavaSheen: 0,
  lavaGoo: 24,

  meterCount: 2,
  meterRise: 300,
  meterDamping: 0.72,
  meterGlow: 0.55,
  meterPeak: 1.4,
  meterPanel: "vanta",
  meterLamp: "warm",

  nixiePanel: "brushed",
  nixieSeconds: true,
  nixie24: true,
  nixieGhost: 0.5,
  nixieGlow: 0.8,
  nixieFlicker: 0.35,

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
  key: ChoiceKey;
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
export type ChoiceKey =
  | "theme"
  | "screen"
  | "meterPanel"
  | "meterLamp"
  | "nixiePanel";

export const GROUPS: Group[] = [
  {
    title: "Screen",
    blurb:
      "Which instrument is running. They share the microphone, the ramp and the tap-anywhere, and nothing else — each group below belongs to one of them.",
    fields: [
      {
        kind: "choice",
        key: "screen",
        label: "Showing",
        options: SCREENS,
        note: "panel reports a level · lava is heated by the room · meter is a needle with mass, showing the level arriving rather than the level.",
      },
    ],
  },
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
    title: "Lava lamp",
    blurb:
      "The other screen. Same microphone, no grid: blobs in a warm viscous fluid, heated from below by whatever the room is doing. Bass is the bulb — it warms the floor, and what rises does so because it is hot rather than because a beat told it to.",
    fields: [
      {
        kind: "number",
        key: "lavaBlobs",
        label: "Blobs",
        min: 3,
        max: 22,
        step: 1,
        note: "How many. Few and large reads as a lamp; many and small reads as a boil.",
      },
      {
        kind: "number",
        key: "lavaSize",
        label: "Size",
        min: 0.05,
        max: 0.32,
        step: 0.005,
        note: "Base radius as a fraction of the short side. Large blobs merge into slow columns; small ones stay separate.",
      },
      {
        kind: "number",
        key: "lavaViscosity",
        label: "Viscosity",
        min: 0.55,
        max: 0.985,
        step: 0.005,
        note: "How thick the fluid is. This is the hypnosis knob — high is slow and inevitable, low is water and reads as agitated.",
      },
      {
        kind: "number",
        key: "lavaBuoyancy",
        label: "Buoyancy",
        min: 0.2,
        max: 3,
        step: 0.05,
        note: "How hard heat lifts. Too much and everything piles at the ceiling instead of circulating.",
      },
      {
        kind: "number",
        key: "lavaHeat",
        label: "Heat from sound",
        min: 0,
        max: 3,
        step: 0.05,
        note: "How much the room stokes the bulb. At 0 the lamp still runs, on its own slow convection.",
      },
      {
        kind: "number",
        key: "lavaKick",
        label: "Kick",
        min: 0,
        max: 3,
        step: 0.05,
        note: "How hard a transient shoves the fluid, over and above heating it. Heat alone has too much thermal mass to show a beat; this is what makes one land. At 0 the lamp only ever responds to the shape of a track, never its rhythm.",
      },
      {
        kind: "toggle",
        key: "lavaLight",
        label: "Ferrofluid",
        note: "Turns the lamp inside out: black fluid on a pale ground instead of lit fluid in the dark. Not a colour swap — the dark version is built by adding light, and nothing added can ever be darker than the paper.",
      },
      {
        kind: "number",
        key: "lavaSheen",
        label: "Sheen",
        min: 0,
        max: 1,
        step: 0.02,
        note: "Ferrofluid only: how wet the fluid looks. 0 is vantablack — no highlight anywhere, so the shapes read as holes cut in the paper rather than as objects on it. Anything above 0 lights the top of each mass and it becomes a black liquid with something to reflect.",
      },
      {
        kind: "number",
        key: "lavaGoo",
        label: "Goo",
        min: 4,
        max: 60,
        step: 1,
        note: "How hard the merge threshold bites. High is taut and mercurial, low is soft and cloudy.",
      },
    ],
  },
  {
    title: "Voltage meter",
    blurb:
      "A moving-coil needle, which is a mechanism rather than a drawing: a coil with mass on a spring, pushed by the signal and fought by its own inertia. It cannot show you a level instantly, and that lag is the entire character — a VU meter is a low-pass filter you can watch.",
    fields: [
      {
        kind: "number",
        key: "meterCount",
        label: "Meters",
        min: 1,
        max: 4,
        step: 1,
        note: "Each takes its own slice of the spectrum, low to high. Two is the pair off the front of a deck.",
      },
      {
        kind: "number",
        key: "meterRise",
        label: "Rise (ms)",
        min: 60,
        max: 900,
        step: 10,
        note: "How long the needle takes to arrive. 300 is the VU standard and is not arbitrary — it is roughly how the ear integrates loudness, which is why the reading looks like what you are hearing.",
      },
      {
        kind: "number",
        key: "meterDamping",
        label: "Damping",
        min: 0.3,
        max: 1.6,
        step: 0.02,
        note: "As a fraction of critical. Below 1 the needle overshoots and settles back, which is what a real one does and most of why it looks alive. At 1 and above it creeps in and never passes the mark.",
      },
      {
        kind: "choice",
        key: "meterPanel",
        label: "Fascia",
        options: METER_PANELS,
        note: "vanta leaves the instruments floating in nothing, lit only by what leaks past their own bezels · brushed sets them into aluminium.",
      },
      {
        kind: "choice",
        key: "meterLamp",
        label: "Lamp",
        options: METER_LAMPS,
        note: "The filter in front of the bulb. warm is a bare incandescent; red, amber, blue and green are the dial colours these arrived in; ramp takes the panel's own palette instead.",
      },
      {
        kind: "number",
        key: "meterGlow",
        label: "Backlight",
        min: 0,
        max: 1,
        step: 0.02,
        note: "The lamp behind the dial. Off is a daylight instrument; up is the warm face of a deck in a dark room.",
      },
      {
        kind: "number",
        key: "meterPeak",
        label: "Peak lamp hold",
        min: 0,
        max: 4,
        step: 0.1,
        note: "Seconds the overload lamp stays lit after the needle passes 0. At 0 there is no lamp.",
      },
    ],
  },
  {
    title: "Nixie clock",
    blurb:
      "Cold-cathode tubes, which are not displays so much as ten numerals of bent wire stacked one behind another in a neon envelope. Only one is lit; the other nine are still in there, and seeing them is the whole thing. Digits in front of the lit one occlude it, which is why a nixie has depth that a printed number never does.",
    fields: [
      {
        kind: "choice",
        key: "nixiePanel",
        label: "Fascia",
        options: NIXIE_PANELS,
        note: "The tubes are mounted behind this, not sitting on it — the panel overlaps their rims, so what you see through each aperture is glass. walnut is what most of these actually lived in.",
      },
      {
        kind: "toggle",
        key: "nixieSeconds",
        label: "Seconds",
        note: "Six tubes rather than four. Off is the calmer clock; on is the one you cannot stop watching.",
      },
      {
        kind: "toggle",
        key: "nixie24",
        label: "24 hour",
        note: "Off runs 12 hour and blanks the leading tube rather than showing a zero — and a blanked tube still shows its ghosts, because the cathodes do not go anywhere when they are unlit.",
      },
      {
        kind: "number",
        key: "nixieGhost",
        label: "Ghost numerals",
        min: 0,
        max: 1,
        step: 0.02,
        note: "How visible the nine unlit cathodes are. At 0 it is a number on a screen; the whole character of the tube is in the first quarter of this knob.",
      },
      {
        kind: "number",
        key: "nixieGlow",
        label: "Glow",
        min: 0,
        max: 1.6,
        step: 0.02,
        note: "How far the discharge bleeds off the wire. Neon wraps the cathode rather than sitting on it, so a little is the point and a lot is a smear.",
      },
      {
        kind: "number",
        key: "nixieFlicker",
        label: "Room",
        min: 0,
        max: 1,
        step: 0.02,
        note: "How much the room reaches the tubes. It only moves the brightness — the supply sagging under a loud passage — because a clock that danced would have stopped being a clock. At 0 it ignores the microphone entirely.",
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


// --- validation --------------------------------------------------------------

/**
 * Keep what is recognisable and drop the rest.
 *
 * The same function guards three doors, which is the reason it lives out here
 * with the schema rather than beside any one of them: a blob out of
 * localStorage that predates a renamed key, a message from another tab, and a
 * request body arriving at PUT /api/settings from anywhere at all. Values are
 * checked against `DEFAULTS` by type and the ramp against the ones that exist,
 * so nothing reaches the render loop that would make it draw something
 * undefined.
 *
 * Deliberately not range-clamped. The bench's minimums and maximums are there
 * to make the sliders usable, not to say what the panel can survive, and a
 * value typed into the number box past the end of its slider is a legitimate
 * thing to want.
 */
export function cleanSettings(input: unknown): Partial<Settings> {
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
    } else if (key === "screen") {
      if (typeof value === "string" && (SCREENS as readonly string[]).includes(value)) {
        out[key] = value;
      }
    } else if (key === "meterPanel") {
      if (typeof value === "string" && (METER_PANELS as readonly string[]).includes(value)) {
        out[key] = value;
      }
    } else if (key === "nixiePanel") {
      if (typeof value === "string" && (NIXIE_PANELS as readonly string[]).includes(value)) {
        out[key] = value;
      }
    } else if (key === "meterLamp") {
      if (typeof value === "string" && (METER_LAMPS as readonly string[]).includes(value)) {
        out[key] = value;
      }
    }
  }

  // `lava` was a boolean before there was a third screen. A device already out
  // there is holding one, and dropping it as unrecognised would quietly send it
  // back to the LED panel — so it is read once more, here, and translated.
  const legacy = (input as { lava?: unknown }).lava;
  if (out.screen === undefined && legacy === true) out.screen = "lava";

  return out as Partial<Settings>;
}
