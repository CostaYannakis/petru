import type { NextRequest, NextResponse } from "next/server";

/**
 * Who is allowed to retune the device.
 *
 * The panel at / is public, because it is a display. The bench is not: anyone
 * who can reach it can change what a screen in someone's room is doing. So the
 * write route and the dashboard both sit behind one password held in
 * `ADMIN_PASSWORD`, and the cookie proving you knew it is signed with a key
 * derived from that same password — which means changing the password
 * invalidates every session already issued, with nothing to remember to revoke.
 *
 * If `ADMIN_PASSWORD` is unset the bench is open, and in production that is
 * treated as "no bench" rather than "no lock": src/app/admin/page.tsx refuses
 * to render it and the write route refuses to write. Failing closed is the only
 * safe reading of a missing password on a public origin.
 */

const COOKIE = "petru.admin";
const MAX_AGE = 60 * 60 * 24 * 30;

export function adminPassword() {
  const password = process.env.ADMIN_PASSWORD;
  return password && password.length > 0 ? password : null;
}

/**
 * The bench needs no password locally, so a fresh clone can tune without any
 * configuration at all. On a public origin, an unset password means closed.
 */
export function adminOpen() {
  return adminPassword() === null && process.env.NODE_ENV !== "production";
}

async function key(password: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`petru.admin:${password}`),
  );
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function token(password: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(password),
    new TextEncoder().encode(COOKIE),
  );
  return b64url(new Uint8Array(signature));
}

/** Constant-time, so the cookie cannot be guessed a byte at a time. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The cookie check on its own, so the /admin page can run it against
 * `cookies()` and the write route against the request, without either having
 * to know how the token is made.
 */
export async function verifyAdminCookie(value: string | undefined) {
  if (adminOpen()) return true;

  const password = adminPassword();
  if (!password || !value) return false;

  return same(value, await token(password));
}

export function isAdmin(request: NextRequest) {
  return verifyAdminCookie(request.cookies.get(COOKIE)?.value);
}

export async function checkPassword(attempt: string) {
  const password = adminPassword();
  if (!password) return false;
  return same(attempt, password);
}

export async function grantAdmin(response: NextResponse) {
  const password = adminPassword();
  if (!password) return;

  response.cookies.set(COOKIE, await token(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export function revokeAdmin(response: NextResponse) {
  response.cookies.set(COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export { COOKIE as ADMIN_COOKIE };
