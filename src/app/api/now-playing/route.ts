import { NextResponse, type NextRequest } from "next/server";
import {
  clearSession,
  readSession,
  setSession,
  type Session,
} from "@/lib/session";
import {
  currentlyPlaying,
  expiring,
  normalise,
  refreshSession,
  SLOW_POLL_MS,
  type ApiResult,
  type NowPlaying,
} from "@/lib/spotify";

/**
 * What is playing, as far as the browser is concerned.
 *
 * The panel polls this and nothing else. It gets a track, a progress reading,
 * and — importantly — how long to wait before asking again, so the pacing lives
 * on one side of the wire instead of being reasoned about twice.
 *
 * Every reply is `no-store`. Spotify's terms allow using their content for the
 * moment you are showing it and not for keeping, and a cover that lingered in a
 * CDN after the song ended would be exactly that.
 */

function reply(body: NowPlaying, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}

export async function GET(request: NextRequest) {
  let session = await readSession(request);
  if (!session?.refresh) {
    return reply({ state: "unauthenticated", nextPollMs: SLOW_POLL_MS });
  }

  let refreshed = false;

  if (expiring(session)) {
    try {
      session = await refreshSession(session);
      refreshed = true;
    } catch {
      // The refresh token has expired or been revoked. There is no recovering
      // from that from here — drop it and let the panel offer to reconnect.
      const response = reply({
        state: "unauthenticated",
        nextPollMs: SLOW_POLL_MS,
      });
      clearSession(response);
      return response;
    }
  }

  const result = await currentlyPlaying(session.access);

  // A 401 against a token we believed was live means it was revoked early.
  // One refresh, one retry, and then we stop — never a loop.
  if (result.kind === "auth" && !refreshed) {
    try {
      session = await refreshSession(session);
      refreshed = true;
    } catch {
      const response = reply({
        state: "unauthenticated",
        nextPollMs: SLOW_POLL_MS,
      });
      clearSession(response);
      return response;
    }

    const retry = await currentlyPlaying(session.access);
    return finish(retry, session, refreshed);
  }

  return finish(result, session, refreshed);
}

async function finish(result: ApiResult, session: Session, refreshed: boolean) {
  let body: NowPlaying;

  switch (result.kind) {
    case "ok":
      body = normalise(result.body);
      break;

    case "rate":
      // Honour Retry-After by handing it to the poller as its next delay. The
      // one thing not to do with a 429 is come back before it says.
      body = { state: "ratelimited", nextPollMs: result.retryAfterMs };
      break;

    case "auth": {
      const response = reply({
        state: "unauthenticated",
        nextPollMs: SLOW_POLL_MS,
      });
      clearSession(response);
      return response;
    }

    case "error":
      // Spotify's own message, so the panel can say something true rather than
      // "something went wrong". Backed off, because whatever it is persists.
      body = { state: "error", nextPollMs: 30_000, message: result.message };
      break;
  }

  const response = reply(body);
  // A refresh usually hands back a new access token and sometimes a new refresh
  // token; either way the sealed cookie is now stale and has to be rewritten.
  if (refreshed) await setSession(response, session);
  return response;
}
