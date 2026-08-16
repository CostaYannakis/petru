"use client";

import { useEffect, useState } from "react";

/**
 * The panel is composed for a phone held sideways. On a phone in portrait we
 * ask for the rotation rather than letting the analyser squash into a strip.
 * Desktop is never gated — only coarse-pointer, phone-width viewports.
 */
const QUERY = "(orientation: portrait) and (max-width: 900px) and (pointer: coarse)";

export default function OrientationGate() {
  const [portrait, setPortrait] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const sync = () => setPortrait(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (!portrait) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black"
      role="img"
      aria-label="Rotate your phone to landscape"
    >
      <div className="relative">
        <div className="h-16 w-28 rounded-[10px] border border-ember shadow-[0_0_28px_-6px_var(--color-orange)]" />
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="pulse absolute -right-9 -top-3 h-7 w-7 text-golden"
          aria-hidden
        >
          <path
            d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M17 3v3.6h-3.6M7 21v-3.6h3.6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
