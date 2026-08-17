"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NowPlaying, NowPlayingTrack } from "@/lib/spotify";

/**
 * Watches /api/now-playing and says when a song has just started.
 *
 * The panel itself never asks Spotify anything — it asks this, and this asks the
 * route handler, which is the only place a token exists. What comes back
 * includes how long to wait before asking again, so the pacing is decided once,
 * server-side, next to the rate limit it is pacing against.
 *
 * The whole point of the exercise is the *transition*, which is a surprisingly
 * narrow thing to detect: a track id that differs from the last one we saw, and
 * a progress reading small enough that we are actually near the downbeat rather
 * than having just woken up in the middle of something.
 */

/** How long the card stays up once a song has started. */
const INTRO_MS = 6_500;

/** ...and how long it then takes to fade, before it stops being rendered. */
const FADE_MS = 420;

/**
 * A change is only a *start* if we caught it early. Coming back from a sleeping
 * phone means the id has changed and the song is four minutes old; that is news,
 * but it is not a downbeat, and announcing it would be a lie about timing.
 */
const START_WINDOW_MS = 12_000;

/** A track that jumps this far backwards without changing id is on repeat. */
const REPEAT_MS = 5_000;

/** The panel is offline or the route handler fell over. Try again, calmly. */
const FAIL_MS = 10_000;

export type Intro = {
  track: NowPlayingTrack;
  /** Changes on every start, so a repeat of the same song replays the card. */
  key: number;
};

export function useNowPlaying() {
  const [state, setState] = useState<NowPlaying["state"]>("idle");
  const [intro, setIntro] = useState<Intro | null>(null);
  /**
   * Held one fade longer than `intro` itself, so the card can animate out
   * instead of disappearing on the frame the timer fires.
   */
  const [open, setOpen] = useState(false);

  // Everything the transition test needs to remember between polls. Refs, not
  // state, because none of it should cause a render on its own.
  const lastId = useRef<string | null>(null);
  const lastProgress = useRef(0);
  const primed = useRef(false);
  const starts = useRef(0);

  const apply = useCallback((body: NowPlaying) => {
    setState(body.state);

    if (body.state !== "playing" && body.state !== "paused") {
      // Nothing is on. Forget the last track so that putting the same song back
      // on after a silence still counts as a start.
      lastId.current = null;
      lastProgress.current = 0;
      primed.current = true;
      return;
    }

    const { track, progressMs } = body;
    const changed = track.id !== lastId.current;
    const restarted =
      !changed && progressMs + REPEAT_MS < lastProgress.current;

    // `primed` is what stops the card firing for whatever happened to be
    // playing when the page loaded. That is not a song starting; it is us
    // arriving late, and the panel should just carry on.
    if (
      primed.current &&
      body.state === "playing" &&
      (changed || restarted) &&
      progressMs < START_WINDOW_MS
    ) {
      starts.current += 1;
      setIntro({ track, key: starts.current });
      setOpen(true);
    }

    lastId.current = track.id;
    lastProgress.current = progressMs;
    primed.current = true;
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    function schedule(ms: number) {
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(poll, ms);
    }

    async function poll() {
      // A backgrounded tab is a phone in a pocket. The panel stops drawing at
      // the same moment; there is nothing to be late for, and polling on from
      // here would only spend request budget on a screen nobody is looking at.
      if (stopped || document.hidden) return;

      try {
        const res = await fetch("/api/now-playing", {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = (await res.json()) as NowPlaying;
        if (stopped) return;

        apply(body);
        schedule(body.nextPollMs);
      } catch {
        // Aborted on unmount, offline, or the handler errored. Either way the
        // panel keeps running — it just does not know the song for a while.
        if (!stopped) schedule(FAIL_MS);
      }
    }

    function onVisibility() {
      if (!document.hidden) poll();
    }

    poll();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [apply]);

  // The card takes itself down: fade first, then stop rendering it. Keyed on
  // the intro itself, so a song arriving mid-card restarts the clock rather
  // than inheriting whatever was left of the last one's.
  useEffect(() => {
    if (!intro) return;

    const close = setTimeout(() => setOpen(false), INTRO_MS);
    const drop = setTimeout(() => setIntro(null), INTRO_MS + FADE_MS);

    return () => {
      clearTimeout(close);
      clearTimeout(drop);
    };
  }, [intro]);

  return { state, intro, open };
}
