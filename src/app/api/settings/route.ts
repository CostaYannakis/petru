import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { cleanSettings } from "@/lib/settings";
import { readShared, storeConfigured, writeShared } from "@/lib/store";

/**
 * The shared tuning.
 *
 * GET is public and has to be: the thing reading it is the panel, which is a
 * display in a room with no session and no reason to have one. There is nothing
 * secret in a set of slider positions.
 *
 * PUT is not. Writing here changes what that display is doing, so it wants the
 * admin cookie, and it revalidates the body against the same schema the bench
 * draws from rather than trusting what arrives.
 */

function reply(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET() {
  // `remote` is what tells the browser whether to treat this as the authority
  // or to carry on with localStorage. It is answered even when the store is
  // absent, so a client can keep asking and light up when one appears.
  if (!storeConfigured()) return reply({ remote: false });

  const settings = await readShared();
  return reply({ remote: settings !== null, settings });
}

export async function PUT(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return reply({ error: "Not signed in." }, { status: 401 });
  }

  if (!storeConfigured()) {
    return reply(
      { error: "No shared store is configured for this deployment." },
      { status: 503 },
    );
  }

  let patch: unknown;
  try {
    patch = await request.json();
  } catch {
    return reply({ error: "Expected a JSON body." }, { status: 400 });
  }

  const clean = cleanSettings(patch);
  if (Object.keys(clean).length === 0) {
    return reply({ error: "Nothing recognisable to set." }, { status: 400 });
  }

  const settings = await writeShared(clean);
  if (!settings) {
    return reply({ error: "The shared store did not accept it." }, { status: 502 });
  }

  return reply({ remote: true, settings });
}
