import { NextResponse, type NextRequest } from "next/server";
import { setHandoff } from "@/lib/session";
import {
  authorizeUrl,
  pkce,
  randomState,
  redirectUri,
  requestOrigin,
} from "@/lib/spotify";

/**
 * Start of the PKCE flow: mint a verifier, park it in an httpOnly cookie, and
 * send the user to Spotify with only its hash.
 *
 * The verifier never leaves this server and the challenge is one-way, so an
 * intercepted authorization code is worth nothing on its own. `state` rides
 * along in the same cookie and is checked on the way back.
 */
export async function GET(request: NextRequest) {
  let redirect: string;
  let url: string;
  let state: string;
  let verifier: string;

  try {
    redirect = redirectUri(requestOrigin(request));
    const challenge = await pkce();
    verifier = challenge.verifier;
    state = randomState();
    url = authorizeUrl({ redirect, challenge: challenge.challenge, state });
  } catch (error) {
    // Misconfiguration — a missing client id, or an origin Spotify will not
    // accept as a redirect. Say which, rather than bouncing the user to a
    // Spotify error page that cannot know.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cannot start Spotify authorization." },
      { status: 500 },
    );
  }

  const response = NextResponse.redirect(url);
  await setHandoff(response, { verifier, state, redirect, from: from(request) });
  return response;
}

/**
 * The query string the panel was running with, taken off the referer.
 *
 * On this device the URL is the whole state — `?theme=ice` is somebody's chosen
 * palette — and connecting an account should not quietly reset it. Only the
 * search is kept, and only from our own origin; the callback rebuilds the path
 * itself, so there is nothing here that could redirect anyone off-site.
 */
function from(request: NextRequest) {
  const referer = request.headers.get("referer");
  if (!referer) return "";

  try {
    const url = new URL(referer);
    return url.origin === requestOrigin(request) ? url.search : "";
  } catch {
    return "";
  }
}
