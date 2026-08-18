import { NextResponse, type NextRequest } from "next/server";
import { adminPassword, checkPassword, grantAdmin, revokeAdmin } from "@/lib/admin";

/**
 * Signing in and out of the bench.
 *
 * One password, no accounts. There is exactly one person who tunes this and no
 * user model worth building for them — but the door still has to be shut,
 * because the bench reaches into a room.
 */

function reply(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: NextRequest) {
  if (!adminPassword()) {
    return reply(
      { error: "No ADMIN_PASSWORD is set for this deployment." },
      { status: 503 },
    );
  }

  let attempt = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password === "string") attempt = body.password;
  } catch {
    // Falls through to the failure below rather than reporting the parse; a
    // sign-in form has no use for the difference.
  }

  if (!(await checkPassword(attempt))) {
    return reply({ error: "That is not the password." }, { status: 401 });
  }

  const response = reply({ ok: true });
  await grantAdmin(response);
  return response;
}

export async function DELETE() {
  const response = reply({ ok: true });
  revokeAdmin(response);
  return response;
}
