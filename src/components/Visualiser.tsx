"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import LedPanel from "@/components/LedPanel";
import { startMic, type MicSource } from "@/lib/mic";

type Status = "off" | "starting" | "live" | "blocked";

/**
 * Owns the microphone so the panel doesn't have to. The panel reads whatever
 * `micRef` currently holds; when that's null it falls back to its own idle
 * animation, so there is never a dead screen.
 *
 * The mic is strictly opt-in — one tap, which is both what Safari requires to
 * unlock audio and the only decent way to ask for someone's microphone.
 */
export default function Visualiser() {
  const micRef = useRef<MicSource | null>(null);
  const [status, setStatus] = useState<Status>("off");

  useEffect(() => {
    return () => {
      micRef.current?.stop();
      micRef.current = null;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (status === "starting") return;

    if (micRef.current) {
      micRef.current.stop();
      micRef.current = null;
      setStatus("off");
      return;
    }

    setStatus("starting");
    try {
      micRef.current = await startMic();
      setStatus("live");
    } catch {
      // Denied, unsupported, or no input device — the idle animation carries on.
      micRef.current = null;
      setStatus("blocked");
    }
  }, [status]);

  const live = status === "live";

  return (
    <>
      <LedPanel micRef={micRef} />

      <button
        type="button"
        onClick={toggle}
        aria-label={live ? "Turn the microphone off" : "Listen to the room"}
        aria-pressed={live}
        className="group absolute z-30 grid h-11 w-11 place-items-center rounded-full transition-opacity duration-300"
        style={{
          bottom: "max(0.9rem, env(safe-area-inset-bottom))",
          right: "max(0.9rem, env(safe-area-inset-right))",
        }}
      >
        <span
          className={[
            "grid h-full w-full place-items-center rounded-full border transition-all duration-300",
            live
              ? "border-golden/70 bg-golden/10 text-golden shadow-[0_0_18px_-2px_var(--color-orange)]"
              : status === "blocked"
                ? "border-ember/40 text-ember/50"
                : "border-ember/50 text-amber/70 group-active:border-golden/70 group-active:text-golden",
          ].join(" ")}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-[18px] w-[18px]"
            aria-hidden
          >
            <rect
              x="9"
              y="3"
              width="6"
              height="11"
              rx="3"
              stroke="currentColor"
              strokeWidth="1.7"
            />
            <path
              d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            {status === "blocked" && (
              <path
                d="M4 4l16 16"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            )}
          </svg>
        </span>
      </button>
    </>
  );
}
