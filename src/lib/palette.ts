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
 * lands on a visibly different colour, and all four of ember/amber/orange/
 * golden get a row rather than golden only ever reaching the top one.
 */
const BAND: Stop[] = [
  [0.0, [116, 28, 5]], // deep ember, at the centre spine
  [0.22, [163, 50, 8]], // ember
  [0.45, [212, 94, 12]], // amber
  [0.68, [246, 134, 18]], // orange
  [0.88, [255, 190, 52]], // golden yellow
  [1.0, [255, 214, 110]], // golden yellow, at the tip
];

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
export const LED_FULL = buildLut(BAND, 1);
export const LED_BODY = buildLut(BAND, 0.78);

/** CSS-side tokens, kept in step with the ramp above. */
export const CSS = {
  black: PANEL_BLACK,
  ember: "#8a2b07",
  amber: "#d9690d",
  orange: "#f78a14",
  golden: "#ffc63c",
} as const;
