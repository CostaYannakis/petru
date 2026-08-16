/**
 * The panel palette.
 *
 * An LED is either off — smoked black, still faintly visible as a dark cell so
 * the grid itself reads — or lit somewhere on a single warm ramp. Colour is a
 * function of a row's distance from the centre line, exactly like a physical
 * matrix panel where each row is wired to its own colour:
 *
 *   centre  ember -> amber -> orange -> golden yellow  tips
 */
type Stop = [pos: number, rgb: [number, number, number]];

/** Behind the panel, and the gaps between LEDs. */
export const PANEL_BLACK = "#000000";

/** An LED with no signal. Smoked — just enough to keep the grid readable. */
export const LED_OFF = "#0b0704";

/**
 * Stops are spaced so that on a coarse panel — six rows per side — each row
 * lands on a visibly different colour rather than two rows sharing one.
 */

/** Warm only: ember through golden yellow, and nothing cooler. */
const BAND_EMBER: Stop[] = [
  [0.0, [116, 28, 5]], // deep ember, at the centre spine
  [0.22, [163, 50, 8]], // ember
  [0.45, [212, 94, 12]], // amber
  [0.68, [246, 134, 18]], // orange
  [0.88, [255, 190, 52]], // golden yellow
  [1.0, [255, 214, 110]], // golden yellow, at the tip
];

/**
 * The Petru display ramp. Same warm core, but the outer rows carry on past
 * golden into white and then blue, the way the hardware does — the cool tips
 * are what give the panel its snap, especially against a dark surround.
 */
const BAND_PETRU: Stop[] = [
  [0.0, [168, 38, 8]], // ember, at the centre spine
  [0.2, [214, 92, 12]], // amber
  [0.4, [247, 138, 20]], // orange
  [0.6, [255, 196, 56]], // golden yellow
  [0.8, [255, 240, 214]], // white
  [0.9, [176, 210, 255]], // pale blue, so white -> blue doesn't go grey
  [1.0, [77, 150, 255]], // blue, at the tip
];

/** Swap `ACTIVE` to change the panel's whole colour identity in one line. */
export const PALETTES = { ember: BAND_EMBER, petru: BAND_PETRU } as const;
const ACTIVE: Stop[] = PALETTES.petru;

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

/**
 * Two pre-baked ramps so the render loop never allocates a colour string:
 * one at full drive, one dimmed for the body of a bar so its tip reads as the
 * brightest LED in the column.
 */
export const LED_FULL = buildLut(ACTIVE, 1);
export const LED_BODY = buildLut(ACTIVE, 0.78);
