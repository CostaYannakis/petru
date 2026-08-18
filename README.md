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
- Or the ramp control on [the bench](#tuning).

A `?theme=` in the URL pins that address to that ramp, so whatever you're
looking at is still something you can send to someone else. Without one, the
ramp comes from the settings store and survives a reload; pressing `t` lets go
of the pin, so the key keeps working on a pinned address.

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
  looking like silence. `minDb`/`maxDb` are the sensitivity: they set the
  window the spectrum is stretched across, and they're deliberately low, so the
  panel is moving properly at conversation level rather than holding its top
  rows back for a volume nobody plays indoors. `agcFloor` caps how far a quiet
  room gets pushed — lower is more sensitive and, past a point, amplified hiss.
- **An idle animation** — used until the mic is switched on, so the panel is
  never a dead screen. Shaped like the real thing: bass on the left, a tilted
  noise floor, per-column phase so neighbouring bars don't move as one slab,
  and a kick on the beat.

Both feed the same ballistics — hard attack, quick release — which is what makes
the microphone read as the same instrument as the idle animation, and what stops
a busy passage smearing into one lit slab. Both also sit on a floor, because a
grid this coarse has few steps and a raw zero reads as a broken column rather
than a quiet one. The floor is what keeps the bottom row lit right across the
panel, so the bars always stand on a deck.

### Dynamics

The panel should be still in a quiet room and go off when there's sound, and
most of the work is in resisting the things that flatten that out.

The mic's auto-gain is the main culprit: it exists so any volume fills the
panel, but left to itself it hauls near-silence up to full scale and nothing is
ever at rest. Three settings pull against it. `noiseGate` decides what counts
as sound at all, and is set high enough that an empty room reads as empty.
`agcFloor` caps how far a quiet one gets pushed, which is what leaves somewhere
for a loud moment to go. Then `punch` expands what survives —
an exponent over the whole range, pulling the middle down so ordinary sound sits
low and only a real hit reaches the top rows.

`punch` is the one to reach for. Raise it for more contrast, and for a panel
that ignores more of what it can technically hear.

### Why the beat lands in the same place

The whole panel is divided by a single gain, so what that gain is measured from
decides whether a rhythm reads as a rhythm.

Measuring it from the loudest column is the obvious choice and it is wrong, in a
way that's hard to see and obvious once measured: every element in the mix takes
turns suppressing the others. A hi-hat lands, becomes the loudest column, the
panel is divided by the hat — and the kick underneath it drops by half. Nothing
about the kick changed. It was just measured against something else. With an
identical kick and a hat coming in and out, that swing was **2.4 rows out of
12**, which is what stops a beat looking like a beat.

So the reference is the **mean across the whole panel**. One loud column barely
moves a twenty-column mean, and the same swing measures **0.1 rows**. It also
drifts rather than snapping — a reference that jumps to the current peak maps
every peak to full scale by construction, so a soft hit and a hard one would
both hit the ceiling.

`agcRoom` then sets where ordinary content sits, since the mean is well below
the peaks it has to leave headroom for. At 1.8 a beat lands about two thirds up
with four rows still above it. Lower pins the panel, higher flattens it.

### Spectral tilt

Music has far more energy at the bottom than the top, so without help the
right-hand columns sit permanently low no matter how sensitive the mic is. The
global auto-gain makes it worse — it normalises against the loudest column,
nearly always a bass one, so the treble ends up scaled by somebody else's gain.
Expansion then squashes hardest exactly where there was least to begin with,
which means **raising `punch` kills the right side first**.

So the mic keeps a slow average per column and applies a gain that pulls each
one toward the panel's mean. The gain comes off the *average*, so it only
flattens the standing shape of the spectrum — whatever a column does around its
own average passes through at full size. That's what equalises the tilt without
touching the dynamics, and it's why the treble can dance as hard as the bass.

`tiltStrength` is how complete the correction is. At `1` every column averages
the same height and the panel is ruled flat; just under, as it is, leaves some
of the natural bass lean. It runs on gated values, so a column with nothing in
it averages zero and is lifted to zero — silence is never equalised into noise.

### Peak markers

Every column leaves a single LED behind at its high-water line. It parks there
for `peakHold`, then sinks at `peakFall` — about two thirds of the panel's
height per second, still well behind a bar that drops away in under half of one.
So the loudest moment of the last second or two stays legible after the sound
has gone, and the marker glides down through the colour band as it falls.

It's the one part of the panel that reports history rather than now, and it's
what makes a transient — a snare, a door — read as an event instead of a
flicker. A marker can never fall past its own bar, so a column that's still loud
wears its marker on top rather than stranding one inside itself.

### Quiet

A silent room would otherwise pin every column to the floor at exactly the same
height, which looks less like a quiet panel than a broken one. Underneath
everything is a slow per-column wander, driven by three incommensurate rates off
a fixed seed so it never repeats and neighbouring columns drift apart, plus a
rare twinkle that pops a single column every couple of seconds.

`shimmer` keeps it to a row or two off the deck — enough that the panel reads as
lit and waiting, not enough to read as something happening. It's weighted by how
little real signal there is, so it vanishes the moment there's sound to show
instead.

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
The `wordmark` toggle on [the bench](#tuning) brings the cycle back.

## Now playing

The microphone is a good way to get a *level* and a hopeless way to get a
*name*. It cannot tell you what the song is, and it certainly cannot tell you
when a new one started. So the two sources stay separate: the phone hears the
speakers, and Spotify says what they are playing. Nothing in the Spotify path
touches the audio path — the panel runs exactly as it did before.

At the top of each song a card comes up for six and a half seconds with the
cover, the title, the artist and the album, and then gets out of the way.

### Why it's a photograph and not LEDs

The obvious idea is to rasterise the cover into the grid the way `PETRU` is
rasterised, and it is the one thing that isn't allowed. Spotify's developer
policy attaches a `VisualAlteration` rule to every endpoint that serves artwork:
visual content must be kept in its original form — no cropping, no overlays, no
logo placed on top. A dot-matrix render is a crop, a recolour and a distortion
at once.

So the cover is shown whole or not at all, and that decides the composition. The
card floats *above* the diffuser rather than under it, because the acrylic sheen
that makes the LEDs look like hardware would be an overlay on somebody's record
sleeve. The only thing done to the image is the 8px corner rounding the design
guidelines allow for optical blending. The Spotify mark sits beside the art,
never on it, and the whole plate links back to the track — that pairing is the
`Attribution` rule, and it is the price of showing the content at all.

The card is `pointer-events-none` apart from the link itself, so the whole
surface is still the microphone control while it's up.

### Catching the downbeat

`GET /me/player/currently-playing`, and one scope: `user-read-currently-playing`.
`user-read-playback-state` would also work and additionally hands over the device
list, volume and shuffle state, none of which a display needs.

A song has started when the track id differs from the last one seen *and* the
progress reading is small — under twelve seconds. Both halves matter. Without the
first, a repeat never registers; without the second, a phone waking from sleep
announces a song that has been playing for four minutes, which is news but is not
a downbeat. The first reply after the page loads only primes the comparison and
never raises a card: that isn't a song starting, it's us arriving late.

Polling is where this could go wrong quietly. A fixed five seconds would find the
next track within five seconds of its downbeat, which is five seconds of the
wrong cover on screen; anything faster is a tight loop against a rate limit for
no reason. So the reply carries its own `nextPollMs` and the panel obeys it:
five seconds at rest, and — because `progress_ms` and `duration_ms` say when the
current track ends — a poll placed just after that moment. Steady state stays at
six calls a minute and the transition still lands on time. A `429` hands back
its `Retry-After` as the next delay, a backgrounded tab stops polling entirely,
and a `401` buys exactly one refresh and one retry before giving up.

### Tokens

Authorization Code with PKCE. There is no client secret in this repo and there
is no token in the browser: the code exchange happens in a route handler and the
result is sealed with AES-GCM into an httpOnly cookie, so the panel only ever
talks to `/api/now-playing` and gets back a track. When the refresh token
finally expires the session is dropped and a small Spotify mark appears in the
corner offering to reconnect — the only chrome the panel ever wears, and it
disappears again the moment it's used.

Every reply is `no-store`. Spotify's terms cover using their content for the
moment you are showing it, not for keeping it, and a cover art file lingering in
a CDN after the song ended would be exactly that. It's also why the card uses a
plain `<img>` rather than `next/image`, which would re-encode the artwork and
hold the result in the image cache.

### Connecting it

Create an app at [the Spotify dashboard](https://developer.spotify.com/dashboard)
and add both redirect URIs:

```
https://<your-domain>/api/spotify/callback
http://127.0.0.1:3000/api/spotify/callback
```

`127.0.0.1` and not `localhost` — Spotify accepts HTTPS and the loopback address
and nothing else, so the panel has to be opened on `http://127.0.0.1:3000` in
development or the redirect is refused. It says so if you get it wrong.

Then two variables in `.env.local`:

| Variable                 | What it is                                                        |
| ------------------------ | ----------------------------------------------------------------- |
| `SPOTIFY_CLIENT_ID`      | From the dashboard. Not `NEXT_PUBLIC_` — this stays server-side.   |
| `SPOTIFY_SESSION_SECRET` | Seals the token cookie. Any long random string; changing it logs everyone out. |

`SPOTIFY_REDIRECT_URI` is available to override the derived one, but shouldn't
be needed: the redirect is built from the host the browser actually asked for,
which is right both in development and behind Vercel's proxy.

Without any of this the panel runs exactly as it always has, on the microphone
and its own idle animation. The card is additive.

## The other screen

There is a second renderer behind a checkbox on the bench: a lava lamp.

It is deliberately the opposite instrument. The panel is a meter — it reports a
level, honestly, sixty times a second, and every bar's height *is* a number.
Nothing in the lamp maps a number to anything. Sound heats the floor, and
everything after that happens because of buoyancy, drag and surface tension. A
bass note does not move a blob; it warms the fluid, and a blob that was already
going to rise rises sooner.

That indirection is the entire effect. It is why the lamp stays hypnotic across
a whole track instead of twitching along with it, and why it never repeats: the
room keeps changing how hard the floor is driven, and the fluid is always still
answering the last thing it was told.

Each blob takes on heat near the base and gives it up near the top, so
everything rises, cools, falls, warms and rises again — one rule, and the whole
circulation falls out of it. Between them there's surface tension: a gentle pull
at conversation distance and a firm push once they're inside each other, so
blobs that meet hang together a while and then let go. A lamp where they either
bounce or merge forever looks like neither. They squash and stretch along their
direction of travel, which is most of why the motion reads as heavy rather than
floaty.

The gooeyness is the metaball trick: plain circles, blurred so neighbours bleed
into one another, then a hard contrast to snap the result back to an edge. What
survives in between is the neck joining two blobs. It's done on opaque black
rather than a transparent surface, because contrast on RGB is well defined
everywhere and contrast on alpha is not.

Colour is two points on the panel's ramp and nothing in between. Mapping it to
height — the obvious move, and the first thing tried — is right for a meter and
wrong for a lamp: it paints a rainbow up the glass and makes every blob change
colour as it drifts, so the fluid reads as a gradient with shapes in front of it.
A lamp is one substance lit from behind. So the ramp is sampled low for the wax
and high for the glow inside it, and the panel's identity survives anyway —
`neon` gives red wax with a yellow core, `ice` teal and pale white, `ember` amber
and gold.

The glow is the same blobs blurred but *not* thresholded, so its brightness is a
real thickness map: one blob is warm in the middle, two lying across each other
are brighter where they overlap. That is most of why it looks lit rather than
painted, and it comes free from not throwing the soft edges away.

### Ferrofluid

There's a checkbox for the pale version: black fluid on near-white paper.

It isn't the dark one with the colours swapped, and it can't be. The dark lamp
is built by *adding* light to black — that's why it glows, and why it can only
ever get brighter. Nothing added is darker than what it lands on, so no amount
of tinting turns it into ink. The pale version runs the same silhouette through
the opposite operation instead: invert it, then multiply it down onto the ground.

The fluid comes out genuinely black, which is what ferrofluid is. The ramp
survives in the paper it sits on and in the sheen along the top of each mass —
that's the soft unthresholded copy again, nudged upward so it reads as a
highlight falling on something wet — and nowhere else. A black liquid is black in
every palette. The bulb goes too: ink on paper isn't lit from below.

The DOM chrome follows via `data-surface` on `<html>`, because the diffuser's
fall-off is drawn in black and black corners on white read as dirt rather than
as depth.

### Knobs

Two matter most. **Viscosity** is the hypnosis one: high is slow and
inevitable, low is water and reads as agitated. **Kick** is how much a transient
shoves the fluid over and above heating it — heat has too much thermal mass to
show a beat, so a kick warms the floor and is gone before anything visibly moves.
Kick is what makes one land. At 0 the lamp answers only the shape of a track and
never its rhythm, which is a legitimate thing to want and not the default.

## Tuning

Every value the panel is tuned by lives in `src/lib/settings.ts` — the numbers
and the reasoning both, since a knob without its argument is just a number. They
are read on the frame that uses them rather than captured at startup, so nothing
here needs a reload.

### The bench

`npm run dev` and open **`/admin`**. It is the whole tuning surface: the real
panel running in a box, with every setting beside it. Not a simplified preview —
the same engine, the same microphone path, the same ballistics — because tuning
against an approximation is worse than not tuning at all.

Changes reach three places, in widening circles:

1. **This page**, immediately — the preview is driven by the same store, so a
   slider is not a form field that gets submitted, it is the thing itself moving.
2. **Every other tab on the origin**, over a `BroadcastChannel`, so the device
   can run full-screen on a second screen while you work on this one. No round
   trip at all.
3. **The deployed panel**, where a shared store is configured — see
   [Live](#live).

They persist in `localStorage`, and **Reset all** puts back the tuning that
shipped, which is exactly the constants this file used to describe.

### Live

Without a shared store the bench is local: changes stay in your browser, the
deployed panel keeps running the defaults compiled into it, and the bench says
so at the top of the page. That is what a fresh clone does.

With one — Upstash Redis, provisioned through the Vercel Marketplace — `/admin`
on the deployed origin becomes a remote control. Writes are debounced and sent
to `PUT /api/settings`; every panel polls `GET /api/settings` every four seconds
and adopts what it finds.

Four seconds rather than as fast as possible, deliberately. A panel left running
is a poll that never stops, and at one second that is eighty thousand reads a
day against a free key-value quota for no benefit anyone can see. A hidden tab
stops asking entirely, so a phone in a pocket costs nothing.

The read side is public, because the thing reading it is a display in a room
with no session and no reason to have one, and there is nothing secret in a set
of slider positions. The write side is not.

### The lock

`ADMIN_PASSWORD` gates both `/admin` and `PUT /api/settings`. The cookie proving
you knew it is signed with a key derived from the password itself, so changing
the password ends every session already open, with nothing to remember to revoke.

Locally, with no password set, the bench is simply open — a fresh clone can tune
without configuring anything. **On a deployed origin an unset password means the
bench is not there at all**: `/admin` 404s and the write route refuses. A missing
password on a public origin can only safely be read as "no bench", never as "no
lock".

### Where to reach first

`punch` for how much the panel ignores. `pitch` for how chunky it reads — the
target centre-to-centre spacing of the diodes in CSS pixels, which also decides
how many steps the amplitude scale has, since every row is one step. Then the
ramp, which is the panel's whole identity — see [the palette](#the-palette).

Defaults still live in code, so once a value is settled it belongs in
`DEFAULTS` — the shared store holds what you are trying, the source holds what
you decided. **Copy JSON** on the bench gives you the current set to paste over.

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
npm run dev      # http://127.0.0.1:3000
npm run build
```

`127.0.0.1` rather than `localhost`, which are the same machine and not the same
origin as far as Spotify's redirect rules are concerned — see
[Now playing](#connecting-it).

Deployed on Vercel.
