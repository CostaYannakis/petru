/**
 * The panel palettes.
 *
 * An LED is either off — smoked black, still faintly visible as a dark cell so
 * the grid itself reads — or lit somewhere on a single ramp. Colour is a
 * function of how high the row sits above the bottom of the panel, exactly like
 * a physical matrix panel where each row is wired to its own colour:
 *
 *   bottom  dim -> mid -> hot -> peak  top
 *
 * A theme is that ramp plus the unlit cell that has to agree with it. The DOM
 * chrome (the diffuser sheen, the orientation gate) is themed separately, in
 * globals.css under a matching `[data-theme]` block — same names, no shared
 * values to keep in sync.
 */
type Stop = [pos: number, rgb: [number, number, number]];

type Theme = {
  /** What this ramp is for, in one line. */
  note: string;
  /**
   * Bottom row to top row. Stops are spaced so that on a coarse panel — a
   * dozen rows or so — each row lands on a visibly different colour rather
   * than two rows sharing one.
   */
  band: Stop[];
  /** An LED with no signal. Smoked towards the band, never a neutral grey. */
  off: string;
};

/** Behind the panel, and the gaps between LEDs. */
export const PANEL_BLACK = "#000000";

/**
 * The full sweep. Blue on the deck, up through violet and hot pink into red,
 * orange and yellow, then round the back of the wheel to ice blue at the top.
 *
 * It works because it is a loop, not a line: the two ends are both blue, so a
 * quiet panel and a pinned one are the same family and the whole thing reads as
 * one object rather than a gradient that ran out. The hot half is in the middle
 * where the bars actually live, and the ice blue only shows on peaks — which is
 * what makes a peak look like an event. Against gloss black the cool ends hold
 * their colour and the warm middle is where the case's sheen lands, so the
 * sheen reads as part of the ramp instead of on top of it.
 */
const BAND_NEON: Stop[] = [
  [0.0, [42, 78, 250]], // blue, on the bottom row
  [0.14, [126, 58, 242]], // violet
  [0.28, [238, 48, 172]], // hot pink
  [0.42, [246, 34, 70]], // red
  [0.56, [252, 110, 20]], // orange
  [0.68, [255, 176, 32]], // amber
  [0.78, [255, 232, 74]], // yellow
  [0.88, [232, 250, 246]], // white, where it turns back to cool
  [0.95, [168, 232, 255]], // pale cyan, so white -> blue doesn't go grey
  [1.0, [92, 198, 255]], // ice blue, on the top row
];

/**
 * Cool instrument ramp, for the black bakelite case: deep petrol on the deck,
 * through cyan, up to ice white at the top.
 *
 * Gloss black kills warm colour — it throws back a brown-grey sheen that sits
 * right on top of ember and amber — but it leaves cyan alone, and the white
 * tops read as reflections off the case rather than against them. The travel
 * here is saturation and luminance rather than hue, which is what stops a
 * one-hue ramp reading as a single colour dimmed six ways.
 */
const BAND_ICE: Stop[] = [
  [0.0, [18, 104, 140]], // deep petrol, on the bottom row
  [0.2, [16, 138, 172]], // teal blue
  [0.42, [22, 178, 205]], // cyan
  [0.62, [64, 220, 226]], // bright aqua
  [0.8, [150, 240, 246]], // pale ice
  [0.92, [214, 250, 255]], // near white
  [1.0, [240, 254, 255]], // ice white, on the top row
];

/**
 * VU ramp. Green at rest, yellow as it works, red only where the peaks reach —
 * the scale off the front of a seventies deck, which is what a black bakelite
 * box asks for. Reads as metering rather than decoration: you can tell how loud
 * the room is from across it.
 */
const BAND_METER: Stop[] = [
  [0.0, [12, 92, 44]], // deep green, on the bottom row
  [0.24, [24, 152, 62]], // green
  [0.46, [124, 200, 40]], // yellow green
  [0.66, [226, 202, 42]], // yellow
  [0.86, [240, 132, 30]], // amber
  [1.0, [234, 44, 28]], // red, on the top row
];

/** Warm only: ember through golden yellow, and nothing cooler. */
const BAND_EMBER: Stop[] = [
  [0.0, [116, 28, 5]], // deep ember, on the bottom row
  [0.22, [163, 50, 8]], // ember
  [0.45, [212, 94, 12]], // amber
  [0.68, [246, 134, 18]], // orange
  [0.88, [255, 190, 52]], // golden yellow
  [1.0, [255, 214, 110]], // golden yellow, on the top row
];

/**
 * Same warm core, but the top rows carry on past golden into white and then
 * blue, the way the hardware does — the cool top is what gives the panel its
 * snap, especially against a dark surround.
 */
const BAND_PETRU: Stop[] = [
  [0.0, [168, 38, 8]], // ember, on the bottom row
  [0.2, [214, 92, 12]], // amber
  [0.4, [247, 138, 20]], // orange
  [0.6, [255, 196, 56]], // golden yellow
  [0.8, [255, 240, 214]], // white
  [0.9, [176, 210, 255]], // pale blue, so white -> blue doesn't go grey
  [1.0, [77, 150, 255]], // blue, on the top row
];

export const THEMES = {
  neon: {
    note: "Blue up through pink and orange, round to ice blue.",
    band: BAND_NEON,
    off: "#05060d",
  },
  ice: {
    note: "Petrol to ice white. Cool, for a black case.",
    band: BAND_ICE,
    off: "#04090c",
  },
  meter: {
    note: "Green to red. A VU scale, for a black case.",
    band: BAND_METER,
    off: "#050a06",
  },
  ember: {
    note: "Ember to golden yellow. Warm only.",
    band: BAND_EMBER,
    off: "#0b0704",
  },
  petru: {
    note: "Ember to golden to white to blue.",
    band: BAND_PETRU,
    off: "#0b0704",
  },
} as const satisfies Record<string, Theme>;

export type ThemeName = keyof typeof THEMES;

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

/**
 * The panel's colour identity. Change this line to change the device.
 * `?theme=<name>` overrides it at runtime, so the four can be compared on the
 * actual hardware without a rebuild.
 */
export const DEFAULT_THEME: ThemeName = "neon";

export function isThemeName(v: string | null | undefined): v is ThemeName {
  return !!v && Object.hasOwn(THEMES, v);
}

/** The next theme in the list, wrapping — for a cycle control. */
export function nextTheme(name: ThemeName): ThemeName {
  const i = THEME_NAMES.indexOf(name);
  return THEME_NAMES[(i + 1) % THEME_NAMES.length];
}

/**
 * The ramps are baked to CSS strings for the render loops, which is right for
 * the panel — it never does anything to a colour but name it. The other screens
 * do: a lit meter face and a sheet of paper are both the ramp blended most of
 * the way to something else, and that needs the numbers back.
 */
export function parseRgb(css: string): [number, number, number] {
  const parts = css.match(/\d+/g);
  if (!parts || parts.length < 3) return [255, 255, 255];
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

export function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  k: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

export function rgb([r, g, b]: [number, number, number], alpha = 1) {
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

const LUT_SIZE = 256;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function buildLut(stops: Stop[], scale: number): string[] {
  const lut = new Array<string>(LUT_SIZE);

  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);

    let s = 0;
    while (s < stops.length - 2 && t > stops[s + 1][0]) s++;

    const [p0, c0] = stops[s];
    const [p1, c1] = stops[s + 1];
    const span = p1 - p0 || 1;
    const k = Math.min(1, Math.max(0, (t - p0) / span));

    const r = Math.round(lerp(c0[0], c1[0], k) * scale);
    const g = Math.round(lerp(c0[1], c1[1], k) * scale);
    const b = Math.round(lerp(c0[2], c1[2], k) * scale);

    lut[i] = `rgb(${r},${g},${b})`;
  }

  return lut;
}

export type Ramp = {
  /** Full drive, for the brightest LED in a column. */
  full: string[];
  /** Dimmed, for the body of a bar, so its tip reads as the peak. */
  body: string[];
  off: string;
};

const built = new Map<ThemeName, Ramp>();

/**
 * Two pre-baked ramps per theme so the render loop never allocates a colour
 * string. Built on first use and kept, since a theme switch is rare and a
 * switch back should not pay for it twice.
 */
export function ramp(name: ThemeName): Ramp {
  let r = built.get(name);
  if (!r) {
    const theme = THEMES[name];
    r = {
      full: buildLut(theme.band, 1),
      body: buildLut(theme.band, 0.78),
      off: theme.off,
    };
    built.set(name, r);
  }
  return r;
}
