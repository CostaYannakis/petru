"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The one door into the bench.
 *
 * No account, no recovery, no "remember me" — one password from the
 * environment, and a cookie signed with a key derived from it, so changing the
 * password ends every session that was open.
 */
export default function AdminLogin() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        // A server component decides what /admin renders, so the page has to be
        // asked again rather than re-rendered from here.
        router.refresh();
        return;
      }

      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "That did not work.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs">
        <h1 className="text-sm font-bold tracking-[0.2em] text-peak">
          PETRU — BENCH
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-mid">
          This bench retunes the panel wherever it is running.
        </p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          aria-label="Admin password"
          placeholder="password"
          className="mt-4 w-full rounded border border-dim/40 bg-black px-3 py-2 text-sm text-peak outline-none focus:border-hot"
        />

        <button
          type="submit"
          disabled={busy}
          className="mt-3 w-full rounded border border-dim/40 px-3 py-2 text-[0.7rem] uppercase tracking-widest text-dim transition-colors hover:border-hot hover:text-hot disabled:opacity-40"
        >
          {busy ? "…" : "Enter"}
        </button>

        {error ? <p className="mt-3 text-xs text-hot">{error}</p> : null}
      </form>
    </div>
  );
}
