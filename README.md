# PETRU

A dot-matrix LED audio visualiser for the browser, built to be looked at on an
iPhone held sideways.

It's a software version of the panel in a Petru Design *Now Playing* display:
chunky square diodes on a fixed pitch, black when off, and colour banded by each
row's distance from the centre line. The panel runs a mirrored spectrum
analyser — off its own idle animation, or off the microphone once you turn it
on.

## The palette

Everything on screen is one warm ramp. An LED is either off — smoked black,
still faintly visible so the grid itself reads — or lit somewhere along:

| Position     | Colour        |
| ------------ | ------------- |
| off          | black         |
| centre spine | ember         |
| mid          | amber         |
| outer        | orange        |
| bar tips     | golden yellow |

The band stops are spaced for a *coarse* grid: with only six rows per side,
each row has to land on a visibly different colour, or golden yellow never
reaches anything but the top row.

Defined once in `src/lib/palette.ts` and mirrored into CSS tokens in
`src/app/globals.css`, so the canvas and the DOM chrome can't drift apart.

## How it works

`src/components/LedPanel.tsx` is the whole engine. Each frame it fills two
arrays — `level` (how hard each LED is driven) and `tone` (where it sits on the
colour band) — and then draws the panel from them. Nothing else touches the
canvas, so whatever produces the levels gets the identical physical treatment:
same pitch, same diode shape, same bloom.

Two sources can fill those arrays:

- **The microphone** (`src/lib/mic.ts`) — a real FFT of the room. Columns are
  spaced logarithmically from 45Hz to 12kHz, the way pitch is heard; linear
  bins would cram every instrument into the left edge. A slow auto-gain means a
  quiet room and a loud one both fill the panel, and a noise gate keeps silence
  looking like silence.
- **An idle animation** — used until the mic is switched on, so the panel is
  never a dead screen. Shaped like the real thing: bass on the left, a tilted
  noise floor, per-column phase so neighbouring bars don't move as one slab,
  and a kick on the beat.

Both feed the same ballistics — snap up, fall away slowly — which is what makes
the microphone read as the same instrument as the idle animation. Both also sit
on a floor, because a grid this coarse has few steps per side and a raw zero
reads as a broken column rather than a quiet one.

### On the microphone

iOS gives no way to tap what another app is playing, so this listens to the
room: the phone hears the speakers. It is strictly opt-in — one tap on the only
control on screen. That is both what Safari requires to unlock an AudioContext
and the only decent way to ask for someone's microphone. Nothing is recorded,
transmitted, or stored; the samples go straight into an FFT and are thrown away.

### The wordmark

`PETRU` rasterised straight into the LED grid, supersampled and thresholded
because a diode is on or off, then coloured across its own cap-to-baseline
height so it uses the whole band. A horizontal wipe hands columns over to it,
with the wipe edge running hot like the panel is being written to.

It's currently **parked** — the panel runs pure spectrum with no text at all.
Flip `SHOW_WORDMARK` in `LedPanel.tsx` to bring the cycle back.

## Tuning

`PITCH_TARGET` in `LedPanel.tsx` is the one knob for how chunky the panel
reads — it's the target centre-to-centre spacing of the diodes in CSS pixels.
Raising it grows the LEDs and coarsens the grid. There's a ceiling on it: the
analyser is mirrored, so the rows have to be split in half, and much past the
current value there aren't enough left to show amplitude with.

## Landscape

The composition assumes a phone on its side. In portrait on a touch device,
`OrientationGate` asks for the rotation instead of letting the analyser squash.
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
