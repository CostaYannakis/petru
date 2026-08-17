/**
 * The Spotify half of the panel.
 *
 * PETRU listens to the room, because iOS gives no way to tap what another app
 * is playing. That is a good way to get a *level* and a hopeless way to get a
 * *name*: the microphone cannot tell you what the song is or when a new one
 * started. So the two sources stay separate — the phone hears the speakers, and
 * Spotify says what they are playing. Nothing here touches the audio path.
 *
 * Authorization Code with PKCE. There is no client secret anywhere in this
 * repo, and the tokens never reach the browser: the exchange happens in a route
 * handler and the result is sealed into an httpOnly cookie (src/lib/session.ts).
 *
 * Endpoint paths, scopes and field names below are taken from the Spotify
 * OpenAPI schema, not from memory:
 * https://developer.spotify.com/reference/web-api/open-api-schema.yaml
 */

import type { NextRequest } from "next/server";
import type { Session } from "@/lib/session";

const AUTHORIZE = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

/**
 * One scope, and it is the narrowest one that answers "what is playing".
 * `user-read-playback-state` would also work and additionally hands over the
 * device list, volume and shuffle state — none of which a display needs.
 */
export const SCOPES = "user-read-currently-playing";

/** Refresh this far ahead of expiry, so a poll never races the clock. */
const REFRESH_MARGIN_MS = 60_000;

export function clientId() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  if (!id) throw new Error("SPOTIFY_CLIENT_ID is not set.");
  return id;
}

/**
 * The origin the browser actually asked for.
 *
 * Not `request.nextUrl.origin`, which the dev server normalises to `localhost`
 * however you reached it — and `localhost` is precisely the host Spotify will
 * not accept as a redirect, so the derived URI would be wrong in exactly the
 * case it matters. The host header is what the browser sent, and behind Vercel
 * the forwarded pair is what survives the proxy.
 */
export function requestOrigin(request: NextRequest) {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return request.nextUrl.origin;

  const proto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");

  return `${proto}://${host}`;
}

/**
 * Where Spotify sends the user back to.
 *
 * Derived from the origin actually being served, so the same build works on the
 * deployed domain and on a laptop, with `SPOTIFY_REDIRECT_URI` to override it
 * when the app sits behind something that rewrites the host.
 *
 * Spotify accepts HTTPS, and http *only* on the loopback address. `localhost`
 * is not accepted however familiar it looks, so the check below is worth its
 * lines: it fails at the point of use with the reason, rather than as an opaque
 * INVALID_CLIENT page after the redirect.
 */
export function redirectUri(origin: string) {
  const configured = process.env.SPOTIFY_REDIRECT_URI;
  const url = configured
    ? new URL(configured)
    : new URL("/api/spotify/callback", origin);

  const loopback = url.protocol === "http:" && url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !loopback) {
    throw new Error(
      `Redirect URI must be https, or http://127.0.0.1 for local development — got ${url.origin}. ` +
        `If you are running \`next dev\`, open the panel on http://127.0.0.1 rather than localhost.`,
    );
  }

  return url.toString();
}

function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A PKCE verifier and its S256 challenge. 96 chars, well inside the 43–128. */
export async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(72)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

export function randomState() {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

export function authorizeUrl(opts: {
  redirect: string;
  challenge: string;
  state: string;
}) {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: clientId(),
    response_type: "code",
    redirect_uri: opts.redirect,
    state: opts.state,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: opts.challenge,
  }).toString();
  return url.toString();
}

type TokenResponse = {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
};

function toSession(token: TokenResponse, fallbackRefresh?: string): Session {
  return {
    access: token.access_token,
    // A refresh response does not always carry a new refresh token; when it
    // doesn't, the old one stays valid and we keep using it.
    refresh: token.refresh_token ?? fallbackRefresh ?? "",
    expires: Date.now() + token.expires_in * 1000,
  };
}

async function postToken(body: URLSearchParams) {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const payload = (await res.json().catch(() => null)) as
    | (TokenResponse & { error?: string; error_description?: string })
    | null;

  if (!res.ok || !payload?.access_token) {
    throw new Error(
      payload?.error_description ??
        payload?.error ??
        `Spotify token endpoint returned ${res.status}.`,
    );
  }

  return payload;
}

export async function exchangeCode(opts: {
  code: string;
  verifier: string;
  redirect: string;
}) {
  const token = await postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirect,
      client_id: clientId(),
      code_verifier: opts.verifier,
    }),
  );
  return toSession(token);
}

/**
 * Swap a refresh token for a live one. PKCE is a public client, so this carries
 * the client id in the body and no Authorization header.
 *
 * Throws when the refresh token itself has expired or been revoked, which is
 * not recoverable — the caller drops the session and the user goes back through
 * authorization.
 */
export async function refreshSession(session: Session) {
  const token = await postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refresh,
      client_id: clientId(),
    }),
  );
  return toSession(token, session.refresh);
}

export function expiring(session: Session) {
  return session.expires - Date.now() < REFRESH_MARGIN_MS;
}

// --- currently playing -----------------------------------------------------

/** The slice of the API's shape this display reads. Field names are the spec's. */
type SpotifyImage = { url: string; height: number | null; width: number | null };

type CurrentlyPlaying = {
  progress_ms: number | null;
  is_playing: boolean;
  currently_playing_type: string;
  item: {
    id: string | null;
    name: string;
    duration_ms: number;
    artists: { name: string }[];
    album: { name: string; images: SpotifyImage[] };
    external_urls: { spotify: string };
  } | null;
};

/** An error body, per the spec's ErrorObject: `{ error: { status, message } }`. */
type SpotifyError = { error?: { status?: number; message?: string } };

export type ApiResult =
  | { kind: "ok"; body: CurrentlyPlaying | null }
  | { kind: "auth"; message: string }
  | { kind: "rate"; retryAfterMs: number }
  | { kind: "error"; message: string };

export async function currentlyPlaying(access: string): Promise<ApiResult> {
  let res: Response;
  try {
    res = await fetch(`${API}/me/player/currently-playing`, {
      headers: { Authorization: `Bearer ${access}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "error", message: "Could not reach Spotify." };
  }

  // Nothing playing. The schema documents only 200/401/403/429, but the API
  // answers 204 with an empty body when the user has no active playback, so
  // both that and a 200 carrying a null item have to mean the same thing here.
  if (res.status === 204) return { kind: "ok", body: null };

  if (res.status === 429) {
    // Seconds, per the header. Fall back to a full minute rather than guessing
    // low — the one thing not to do with a 429 is come straight back.
    const after = Number(res.headers.get("Retry-After"));
    return {
      kind: "rate",
      retryAfterMs: (Number.isFinite(after) && after > 0 ? after : 60) * 1000,
    };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as SpotifyError | null;
    const message = body?.error?.message ?? `Spotify returned ${res.status}.`;

    // 401 is an expired or revoked token; 403 with this scope generally means
    // consent was withdrawn. Both are answered by authorizing again.
    if (res.status === 401 || res.status === 403) return { kind: "auth", message };
    return { kind: "error", message };
  }

  const body = (await res.json().catch(() => null)) as CurrentlyPlaying | null;
  return { kind: "ok", body: body?.item ? body : null };
}

// --- what the browser gets -------------------------------------------------

export type NowPlayingTrack = {
  id: string;
  name: string;
  artists: string;
  album: string;
  /** The largest image Spotify offers, passed through untouched. */
  image: SpotifyImage | null;
  /** The link back to Spotify that has to accompany anything shown. */
  url: string;
  durationMs: number;
};

export type NowPlaying =
  | { state: "unauthenticated"; nextPollMs: number }
  | { state: "idle"; nextPollMs: number }
  | { state: "ratelimited"; nextPollMs: number }
  | { state: "error"; nextPollMs: number; message: string }
  | {
      state: "playing" | "paused";
      nextPollMs: number;
      track: NowPlayingTrack;
      progressMs: number;
    };

/** Idle cadence: six calls a minute, nowhere near any rate limit. */
const POLL_MS = 5_000;

/** Nothing playing, or nobody connected — no reason to ask often. */
const SLOW_POLL_MS = 15_000;

export function normalise(body: CurrentlyPlaying | null): NowPlaying {
  const item = body?.item;

  // Ads, podcast episodes and anything Spotify calls `unknown` have no artist
  // and no cover worth showing, so they read as idle rather than as a track.
  if (!body || !item || !item.id || body.currently_playing_type !== "track") {
    return { state: "idle", nextPollMs: SLOW_POLL_MS };
  }

  const progressMs = body.progress_ms ?? 0;

  // Images come back widest first. Take the largest and leave it alone: it is
  // displayed at whatever size it arrives, never cropped or re-encoded.
  const image = item.album.images[0] ?? null;

  return {
    state: body.is_playing ? "playing" : "paused",
    nextPollMs: body.is_playing
      ? nextPoll(progressMs, item.duration_ms)
      : SLOW_POLL_MS,
    progressMs,
    track: {
      id: item.id,
      name: item.name,
      artists: item.artists.map((a) => a.name).join(", "),
      album: item.album.name,
      image,
      url: item.external_urls.spotify,
      durationMs: item.duration_ms,
    },
  };
}

/**
 * When to ask again.
 *
 * A fixed five seconds finds the next track within five seconds of its
 * downbeat, which is five seconds of the wrong cover on screen. So the poll
 * also watches the clock: if this track is about to end, come back just after
 * it does. Steady state stays at one call per five seconds and the transition
 * still lands on time.
 */
function nextPoll(progressMs: number, durationMs: number) {
  const remaining = durationMs - progressMs;
  return Math.max(1_000, Math.min(POLL_MS, remaining + 400));
}

export { SLOW_POLL_MS };
