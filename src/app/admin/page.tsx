import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import AdminLogin from "@/components/AdminLogin";
import SettingsDashboard from "@/components/SettingsDashboard";
import { ADMIN_COOKIE, adminOpen, adminPassword, verifyAdminCookie } from "@/lib/admin";

/**
 * The bench, at /admin.
 *
 * Locally it is simply there — a fresh clone can tune the panel with no
 * configuration at all. On a deployed origin it is behind `ADMIN_PASSWORD`,
 * because from there it reaches a screen in a room, and an unset password is
 * read as "there is no bench here" rather than "the bench is unlocked".
 *
 * The eventual home for anything else that needs a control surface; for now it
 * is the visualiser and nothing else.
 */
export default async function Admin() {
  // Read the request before deciding anything. `cookies()` is what opts this
  // route into being rendered per request — check the password first and the
  // page prerenders at build time instead, freezing whichever answer the build
  // environment happened to give into a static file.
  const jar = await cookies();

  if (!adminOpen() && !adminPassword()) notFound();

  const signedIn = await verifyAdminCookie(jar.get(ADMIN_COOKIE)?.value);

  return (
    // The body is locked to the viewport and non-scrolling for the panel's
    // sake, so the bench does its own scrolling inside that.
    <main className="h-[100dvh] overflow-y-auto bg-black font-mono text-mid">
      {signedIn ? <SettingsDashboard /> : <AdminLogin />}
    </main>
  );
}
