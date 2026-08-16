# PETRU

A dot-matrix LED audio visualiser for the browser, built to be looked at on an
iPhone held sideways.

It's a software version of the panel in a Petru Design *Now Playing* display:
chunky square diodes on a fixed pitch, smoked black when off, and colour banded
by each row's distance from the centre line. The panel runs a mirrored spectrum
analyser, then wipes across to the PETRU wordmark and back, on a loop.

## The palette

Everything on screen is one warm ramp. An LED is either off — smoked black,
still faintly visible so the grid itself reads — or lit somewhere along:

| Position                   | Colour        |
| -------------------------- | ------------- |
| off                        | smoked black  |
| centre spine               | ember         |
| mid                        | amber         |
| outer                      | orange        |
| bar tips / wordmark caps   | golden yellow |

Defined once in `src/lib/palette.ts` and mirrored into CSS tokens in
`src/app/globals.css`, so the canvas and the DOM chrome can't drift apart.

## How it works

`src/components/LedPanel.tsx` is the whole engine. Each frame it fills two
arrays — `level` (how hard each LED is driven) and `tone` (where it sits on the
colour band) — and then draws the panel from them. Nothing else touches the
canvas, so whatever produces the levels gets the identical physical treatment:
same pitch, same diode shape, same bloom.

Two sources fill those arrays:

- **Spectrum** — a synthetic analyser. There is no microphone and nothing asks
  the viewer for permission, but it is shaped like the real thing: bass on the
  left, a tilted noise floor, per-column phase so neighbouring bars don't move
  as one slab, and a kick on the beat. Analyser ballistics snap up and fall
  away slowly.
- **Wordmark** — `PETRU` rasterised straight into the LED grid, supersampled
  and thresholded, because a diode is on or off. It's coloured across its own
  cap-to-baseline height rather than the panel's centre line, so it uses the
  whole band instead of sitting in the ember rows.

A horizontal wipe hands columns from one source to the other, with the wipe
edge itself running hot like the panel is being written to.

## Landscape

The composition assumes a phone on its side. In portrait on a touch device,
`OrientationGate` asks for the rotation instead of letting the wordmark squash.
The panel runs edge to edge under the notch (`viewport-fit=cover`); the chrome
insets itself out of the way with `env(safe-area-inset-*)`.

`prefers-reduced-motion` slows the whole clock rather than freezing it, so the
panel still reads as a panel.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
```

Deployed on Vercel.
