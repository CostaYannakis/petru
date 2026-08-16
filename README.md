# PETRU

A dot-matrix LED audio visualiser for the browser, built to be looked at on an
iPhone held sideways.

It's a software version of the panel in a Petru Design *Now Playing* display:
chunky square diodes on a fixed pitch, black when off, and colour banded by each
row's distance from the centre line. The panel runs a mirrored spectrum
analyser — off its own idle animation, or off the microphone once you turn it
on.

## The palette

Everything on screen is one ramp. An LED is either off — smoked black, still
faintly visible so the grid itself reads — or lit somewhere along it, by how far
its row sits from the centre line.

There are four ramps, all in `src/lib/palette.ts`:

| Row from the centre | `ice` ← default | `meter`      | `ember`       | `petru`       |
| ------------------- | --------------- | ------------ | ------------- | ------------- |
| 0 — the spine       | deep petrol     | green        | ember         | ember         |
| 1                   | teal blue       | green        | ember         | amber         |
| 2                   | cyan            | yellow green | amber         | orange        |
| 3                   | bright aqua     | yellow       | orange        | golden yellow |
| 4                   | pale ice        | amber        | golden yellow | white         |
| 5 — the tip         | ice white       | red          | golden yellow | blue          |

**`ice`** is what the black bakelite case wants. Gloss black throws back a
brown-grey sheen that sits right on top of ember and amber and takes the life
out of them; it leaves cyan alone, and the ice-white tips read as reflections
off the case rather than fighting them. The travel along the ramp is saturation
and luminance rather than hue, which is what stops a one-hue ramp reading as a
single colour dimmed six ways.

**`meter`** is the other one that suits a black box: the VU scale off the front
of a seventies deck. Green at rest, yellow as it works, red only where the peaks
reach — you can read how loud the room is from across it.

**`ember`** and **`petru`** are the original warm ramps, kept. `petru` is the
one the hardware does, warm core out to white and blue tips.

### Switching

`DEFAULT_THEME` in `palette.ts` is what the device ships as. To compare them
without a rebuild:

- `?theme=ice` · `?theme=meter` · `?theme=ember` · `?theme=petru` — bookmark two
  URLs and flick between them on the actual hardware.
- Press **`t`** to cycle, which is quicker at a desk.

Nothing is persisted; the URL is the whole state, so whatever you're looking at
is something you can send to someone else.

The stops are spaced for a *coarse* grid. With only six rows per side each row
has to land on a visibly different colour, or two rows share one and the ramp
reads as four colours instead of six. `petru` has an extra stop between white
and blue for the same reason, so panels with more rows don't interpolate through
grey.

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
  looking like silence.
- **An idle animation** — used until the mic is switched on, so the panel is
  never a dead screen. Shaped like the real thing: bass on the left, a tilted
  noise floor, per-column phase so neighbouring bars don't move as one slab,
  and a kick on the beat.

Both feed the same ballistics — snap up, fall away slowly — which is what makes
the microphone read as the same instrument as the idle animation. Both also sit
on a floor, because a grid this coarse has few steps per side and a raw zero
reads as a broken column rather than a quiet one.

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
Raising it grows the LEDs and coarsens the grid. There's a ceiling on it: the
analyser is mirrored, so the rows have to be split in half, and much past the
current value there aren't enough left to show amplitude with.

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
