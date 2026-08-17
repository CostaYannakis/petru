"use client";

import { useNowPlaying, type Intro } from "@/lib/now-playing";

/**
 * The card that introduces a song.
 *
 * The obvious idea — rasterise the cover into the LED grid the way the wordmark
 * is rasterised — is the one thing that isn't allowed. Spotify's developer
 * policy attaches a `VisualAlteration` rule to every endpoint that serves
 * artwork: "Spotify visual content must be kept in its original form, e.g. you
 * can not crop album artwork, overlay images on album artwork, place a
 * brand/logo on album artwork." A dot-matrix render is a crop, a recolour and a
 * distortion at once, so the cover is shown as a photograph or not at all.
 *
 * That constraint decides the whole composition. The art sits on its own, whole
 * and unfiltered, on a plate that floats *above* the diffuser rather than under
 * it — the acrylic sheen in globals.css is beautiful on the LEDs and would be an
 * overlay on somebody's record sleeve. Only the corners are touched, and only by
 * the 8px the design guidelines allow for optical blending.
 *
 * The `Attribution` rule is the other half: the mark is present, beside the art
 * and never on it, and the whole plate links back to the track on Spotify.
 *
 * Everything here is transient. The card holds for a few seconds at the top of
 * a song and then gets out of the way, because the panel is the product.
 */

export default function NowPlayingCard() {
  const { state, intro, open } = useNowPlaying();

  return (
    <>
      {intro ? <Plate intro={intro} open={open} /> : null}
      {state === "unauthenticated" ? <Connect /> : null}
    </>
  );
}

function Plate({ intro, open }: { intro: Intro; open: boolean }) {
  const { track } = intro;

  return (
    <div
      // Above the diffuser (z-10) so no sheen lands on the artwork, and above
      // the tap-to-listen surface (z-30) so the link back to Spotify is
      // reachable — but transparent to taps everywhere except the plate itself,
      // because the whole screen is still the microphone control.
      className={`card-in pointer-events-none absolute inset-0 z-40 grid place-items-center px-[max(1.5rem,env(safe-area-inset-left))] transition-opacity duration-[420ms] ease-out ${
        open ? "opacity-100" : "opacity-0"
      }`}
      aria-live="polite"
    >
      {/*
        A vignette rather than a curtain. Enough dark under the middle to sit
        the plate on, falling away to nothing at the edges, so the panel is
        still visibly running either side of the card for the whole six seconds
        — the visualiser is the product and the card is a caption on it.
      */}
      <div className="absolute inset-0 bg-[radial-gradient(65%_75%_at_50%_50%,rgb(0_0_0/0.78)_0%,rgb(0_0_0/0.45)_55%,rgb(0_0_0/0)_100%)]" />

      <a
        href={track.url}
        target="_blank"
        rel="noreferrer"
        // The plate is solid: the type has to be legible over whatever the
        // spectrum is doing behind it, and a title that flickers with the bass
        // is worse than one that covers a few columns for a moment.
        className="plate-in pointer-events-auto relative flex items-center gap-6 rounded-2xl border border-dim/20 bg-black/92 p-4 pr-6 shadow-[0_0_70px_-10px_#000] outline-none focus-visible:ring-2 focus-visible:ring-peak"
      >
        {track.image ? (
          <div className="h-[min(46vh,220px)] w-[min(46vh,220px)] shrink-0 bg-black">
            {/*
              A plain <img>, deliberately. next/image would re-encode the cover
              and keep the result in the CDN cache, which is both an alteration
              of the artwork and a copy of Spotify content held past the moment
              it was needed. This is the file Spotify served, at the size Spotify
              served it, dropped the instant the card closes.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={track.image.url}
              alt={`${track.album} cover art`}
              width={track.image.width ?? undefined}
              height={track.image.height ?? undefined}
              decoding="async"
              // object-contain, so a cover that is somehow not square letterboxes
              // instead of being cropped to fit.
              className="h-full w-full rounded-lg object-contain"
            />
          </div>
        ) : null}

        <div className="min-w-0 max-w-[46vw]">
          {/*
            Titles exactly as Spotify gave them. Truncation is the one licence
            the guidelines allow when there isn't room, and the full text stays
            in the title attribute.
          */}
          <p
            className="truncate text-[clamp(1.1rem,3.4vw,1.9rem)] font-bold tracking-tight text-peak"
            title={track.name}
          >
            {track.name}
          </p>
          <p
            className="mt-1 truncate text-[clamp(0.85rem,2.4vw,1.2rem)] text-hot"
            title={track.artists}
          >
            {track.artists}
          </p>
          <p
            className="mt-0.5 truncate text-[clamp(0.7rem,1.9vw,0.95rem)] text-mid opacity-80"
            title={track.album}
          >
            {track.album}
          </p>

          <span className="mt-4 flex items-center gap-2 text-[clamp(0.65rem,1.7vw,0.8rem)] uppercase tracking-widest text-dim">
            <SpotifyMark className="h-4 w-4 shrink-0" />
            Play on Spotify
          </span>
        </div>
      </a>
    </div>
  );
}

/**
 * The only chrome the panel ever wears, and it is only worn until it is used:
 * once an account is connected this is gone and the surface is undecorated
 * again. Bottom right, inside the safe area, out of the way of the tap that
 * starts the microphone.
 */
function Connect() {
  return (
    // A bare href: the login route recovers whatever `?theme=` the panel was
    // running with from the referer, rather than this having to read the URL
    // during render and disagree with what the server sent.
    <a
      href="/api/spotify/login"
      className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))] z-40 flex items-center gap-2 rounded-full px-3 py-2 text-[0.65rem] uppercase tracking-widest text-dim opacity-60 outline-none transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-peak"
    >
      <SpotifyMark className="h-4 w-4" />
      Connect
    </a>
  );
}

/**
 * The Spotify mark. Required wherever their content is shown, and required to
 * be somewhere other than on top of the artwork.
 */
function SpotifyMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}
