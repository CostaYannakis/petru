import type { NextRequest, NextResponse } from "next/server";

/**
 * Where the Spotify tokens live.
 *
 * The panel is a page left running on a phone, so the one thing that must not
 * happen is a token sitting somewhere a script can read it. Everything here is
 * sealed into an httpOnly cookie: the browser carries it, only the route
 * handlers can open it, and the client half of the app never sees a token at
 * all — it talks to /api/now-playing and gets back a track.
 *
 * Sealed rather than merely signed, because a refresh token is a credential and
 * this cookie is handed to a device that may not be ours. AES-GCM off a key
 * derived from SPOTIFY_SESSION_SECRET, which is the only secret this app has —
 * PKCE means there is no client secret to leak in the first place.
 *
 * Read off the request and written onto the response, rather than through the
 * ambient cookie store, so that a handler which both sets a cookie and redirects
 * has no question about which of those wins.
 */

const SESSION = "petru.spotify";
const HANDOFF = "petru.spotify.pkce";

/** A refresh token outlives any sensible session, so the cookie is annual. */
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

/** The verifier only has to survive the round trip to Spotify and back. */
const HANDOFF_MAX_AGE = 60 * 10;

export type Session = {
  access: string;
  refresh: string;
  /** Epoch ms at which the access token stops working. */
  expires: number;
};

/** The half of the PKCE exchange that has to wait here while the user is away. */
export type Handoff = {
  verifier: string;
  state: string;
  /** Pinned at /authorize time, because the exchange has to send the same one. */
  redirect: string;
  /**
   * The query string the panel was running with, carried across the round trip.
   * On this device the URL is the whole state — `?theme=ice` is somebody's
   * chosen palette — and connecting an account should not quietly reset it.
   */
  from: string;
};

function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(text: string) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function key() {
  const secret = process.env.SPOTIFY_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SPOTIFY_SESSION_SECRET is not set — the Spotify session cookie cannot be sealed.",
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function seal(value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new TextEncoder().encode(JSON.stringify(value));
  const box = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), body),
  );

  const packed = new Uint8Array(iv.length + box.length);
  packed.set(iv);
  packed.set(box, iv.length);
  return b64url(packed);
}

async function unseal<T>(packed: string | undefined): Promise<T | null> {
  if (!packed) return null;
  try {
    const bytes = unb64url(packed);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, 12) },
      await key(),
      bytes.subarray(12),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    // Tampered, truncated, or sealed under a secret that has since changed.
    // Either way there is no session — the caller sends the user back through
    // authorization rather than trying to salvage it.
    return null;
  }
}

/** Dev runs on http://127.0.0.1, which cannot carry a `Secure` cookie. */
const secure = process.env.NODE_ENV === "production";

const options = {
  httpOnly: true,
  secure,
  sameSite: "lax",
  path: "/",
} as const;

export function readSession(req: NextRequest) {
  return unseal<Session>(req.cookies.get(SESSION)?.value);
}

export async function setSession(res: NextResponse, session: Session) {
  res.cookies.set(SESSION, await seal(session), {
    ...options,
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSession(res: NextResponse) {
  res.cookies.set(SESSION, "", { ...options, maxAge: 0 });
}

export function readHandoff(req: NextRequest) {
  return unseal<Handoff>(req.cookies.get(HANDOFF)?.value);
}

export async function setHandoff(res: NextResponse, handoff: Handoff) {
  res.cookies.set(HANDOFF, await seal(handoff), {
    ...options,
    maxAge: HANDOFF_MAX_AGE,
  });
}

export function clearHandoff(res: NextResponse) {
  res.cookies.set(HANDOFF, "", { ...options, maxAge: 0 });
}
