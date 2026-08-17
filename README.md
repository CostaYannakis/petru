# PETRU

A dot-matrix LED audio visualiser for the browser, built to be looked at on an
iPhone held sideways.

It's a software version of the panel in a Petru Design *Now Playing* display:
chunky square diodes on a fixed pitch, black when off, and colour banded by how
high each row sits. Bars stand on the bottom row and grow upward, off the
panel's own idle animation or off the microphone once you turn it on.

## The palette

Everything on screen is one ramp. An LED is either off — smoked black, still
faintly visible so the grid itself reads — or lit somewhere along it, at the
point matching its height up the panel. A column's top LED is therefore both its
level and its colour: the band is the scale printed beside the meter.

There are five ramps, all in `src/lib/palette.ts`, each written bottom to top:

| Ramp             | Bottom → top                                                       |
| ---------------- | ------------------------------------------------------------------ |
| `neon` ← default | blue · violet · hot pink · red · orange · amber · yellow · white · ice blue |
| `ice`            | deep petrol · teal · cyan · aqua · pale ice · ice white             |
| `meter`          | green · yellow green · yellow · amber · red                        |
| `ember`          | deep ember · ember · amber · orange · golden yellow                |
| `petru`          | ember · amber · orange · golden yellow · white · blue              |

**`neon`** is the default. It works because it's a *loop* rather than a line —
both ends are blue, so a quiet panel and a pinned one are the same family and
the whole thing reads as one object instead of a gradient that ran out. The hot
half sits in the middle where the bars actually live; the ice blue only appears
on peaks, which is what makes a peak look like an event. Against gloss black the
cool ends hold their colour and the case's sheen lands on the warm middle, so it
reads as part of the ramp rather than on top of it.

**`ice`** is the cool one: gloss black throws back a brown-grey sheen that sits
right on top of ember and amber and takes the life out of them, but leaves cyan
alone. Its travel is saturation and luminance rather than hue.

**`meter`** is the VU scale off the front of a seventies deck — green at rest,
yellow as it works, red only where the peaks reach. Bottom-up bars make it
literal: it *is* a meter.

**`ember`** and **`petru`** are the original warm ramps, kept. `petru` is the
one the hardware does, warm below and white and blue on top.

### Switching

`DEFAULT_THEME` in `palette.ts` is what the device ships as. To compare them
without a rebuild:

- `?theme=neon` · `?theme=ice` · `?theme=meter` · `?theme=ember` ·
  `?theme=petru` — bookmark two URLs and flick between them on the actual
  hardware.
- Press **`t`** to cycle, which is quicker at a desk.

Nothing is persisted; the URL is the whole state, so whatever you're looking at
is something you can send to someone else.

The stops are spaced for a *coarse* grid. A dozen rows is all a phone gives, so
each one has to land on a visibly different colour or two rows share one and the
ramp reads as fewer colours than it has. Both `neon` and `petru` carry an extra
stop on the way from white to blue, so panels with more rows don't interpolate
through grey.

The bands live in `src/lib/palette.ts`; the DOM chrome — the diffuser sheen, the
orientation gate — is themed alongside them in `src/app/globals.css` under a
matching `[data-theme]` block, which `src/lib/theme.ts` sets on `<html>`. The
tokens there are named for where they sit on the ramp (`dim`, `mid`, `hot`,
`peak`) rather than for a hue, so they survive a theme that isn't warm. No
colour value is written in both files.

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
  looking like silence. `MIN_DB`/`MAX_DB` are the sensitivity: they set the
  window the spectrum is stretched across, and they're deliberately low, so the
  panel is moving properly at conversation level rather than holding its top
  rows back for a volume nobody plays indoors. `AGC_FLOOR` caps how far a quiet
  room gets pushed — lower is more sensitive and, past a point, amplified hiss.
- **An idle animation** — used until the mic is switched on, so the panel is
  never a dead screen. Shaped like the real thing: bass on the left, a tilted
  noise floor, per-column phase so neighbouring bars don't move as one slab,
  and a kick on the beat.

Both feed the same ballistics — snap up, fall away slowly — which is what makes
the microphone read as the same instrument as the idle animation. Both also sit
on a floor, because a grid this coarse has few steps and a raw zero reads as a
broken column rather than a quiet one. The floor is what keeps the bottom row
lit right across the panel, so the bars always stand on a deck.

### Peak markers

Every column leaves a single LED behind at its high-water line. It parks there
for `PEAK_HOLD`, then sinks at `PEAK_FALL` — about a third of the panel's height
per second, against a bar that drops away in under half of one. So the loudest
moment of the last few seconds stays legible after the sound has gone, and the
marker glides down through the colour band as it falls.

It's the one part of the panel that reports history rather than now, and it's
what makes a transient — a snare, a door — read as an event instead of a
flicker. A marker can never fall past its own bar, so a column that's still loud
wears its marker on top rather than stranding one inside itself.

### Quiet

A silent room would otherwise pin every column to the floor at the same height,
which looks less like a quiet panel than a broken one. Underneath everything is
a slow per-column wander, driven by three incommensurate rates off a fixed seed
so it never repeats and neighbouring columns drift apart, plus a sparse twinkle
that pops a random column now and then. It's weighted by how little real signal
there is, so it vanishes the moment there's music to show instead.

### On the microphone

iOS gives no way to tap what another app is playing, so this listens to the
room: the phone hears the speakers.

It is strictly opt-in. Nothing is drawn over the panel — the whole surface is
the control, so **tap anywhere** to start listening and tap again to stop. That
tap isn't decoration: Safari won't unlock an AudioContext without a gesture, and
a page shouldn't reach for a microphone unprompted. The panel is its own
feedback, since it starts moving with the room.

Nothing is recorded, transmitted, or stored; the samples go straight into an
FFT and are thrown away.

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
Raising it grows the LEDs and coarsens the grid, and takes steps off the
amplitude scale with it, since every row is now one step.

`DEFAULT_THEME` in `palette.ts` is the other one — see [the palette](#the-palette).

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
