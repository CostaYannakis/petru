import { NextResponse, type NextRequest } from "next/server";
import {
  clearHandoff,
  readHandoff,
  setSession,
  type Handoff,
} from "@/lib/session";
import { exchangeCode, requestOrigin } from "@/lib/spotify";

/**
 * The other end of the PKCE flow.
 *
 * Everything here can fail in a way that is nobody's fault — the user can press
 * cancel, the tab can be left open until the verifier cookie has expired — so
 * every path lands back on the panel rather than on an error page. The panel is
 * the product; a failed connection just means it carries on without a card.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const handoff = await readHandoff(request);

  const back = (query: string) =>
    // The path is fixed here, so the carried-over query string cannot send
    // anyone anywhere but this panel.
    NextResponse.redirect(new URL(`/${query}`, requestOrigin(request)));

  const fail = (reason: string) => {
    const response = back(withFlag(handoff, reason));
    clearHandoff(response);
    return response;
  };

  // The user pressed cancel, or Spotify refused the request outright.
  const denied = params.get("error");
  if (denied) return fail(denied === "access_denied" ? "denied" : "failed");

  const code = params.get("code");
  if (!code || !handoff) return fail("failed");

  // Anything arriving without the state we issued did not come from our
  // /authorize call, and is not exchanged.
  if (params.get("state") !== handoff.state) return fail("failed");

  try {
    const session = await exchangeCode({
      code,
      verifier: handoff.verifier,
      redirect: handoff.redirect,
    });

    const response = back(handoff.from);
    await setSession(response, session);
    clearHandoff(response);
    return response;
  } catch {
    return fail("failed");
  }
}

/**
 * Put the outcome on the URL without losing what was already there — the panel
 * reads `?theme=` off the same string.
 */
function withFlag(handoff: Handoff | null, reason: string) {
  const query = new URLSearchParams(handoff?.from ?? "");
  query.set("spotify", reason);
  return `?${query.toString()}`;
}
