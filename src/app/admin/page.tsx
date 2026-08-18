import { notFound } from "next/navigation";
import SettingsDashboard from "@/components/SettingsDashboard";

/**
 * The local bench, at /admin.
 *
 * Development only. It exists to tune the panel with the panel in front of you,
 * and there is no reason for a device left running in a room to carry a page
 * that can retune it — so in production this route is simply not there.
 *
 * The eventual home for anything else that needs a control surface; for now it
 * is the visualiser and nothing else.
 */
export default function Admin() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    // The body is locked to the viewport and non-scrolling for the panel's
    // sake, so the bench does its own scrolling inside that.
    <main className="h-[100dvh] overflow-y-auto bg-black font-mono text-mid">
      <SettingsDashboard />
    </main>
  );
}
