"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import LedPanel from "@/components/LedPanel";
import { startMic, type MicSource } from "@/lib/mic";
import { useTheme } from "@/lib/theme";

/**
 * Owns the microphone so the panel doesn't have to. The panel reads whatever
 * `micRef` currently holds; when that's null it falls back to its own idle
 * animation, so there is never a dead screen.
 *
 * Nothing is drawn over the panel — the whole surface is the control. A tap
 * anywhere starts listening, another stops. That tap is not decoration: Safari
 * will not unlock an AudioContext without a gesture, and a page should not
 * reach for a microphone unprompted. The panel itself is the only feedback,
 * since it starts moving with the room.
 */
export default function Visualiser() {
  const micRef = useRef<MicSource | null>(null);
  const [live, setLive] = useState(false);
  const busy = useRef(false);
  const { theme } = useTheme();

  useEffect(() => {
    return () => {
      micRef.current?.stop();
      micRef.current = null;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;

    try {
      if (micRef.current) {
        micRef.current.stop();
        micRef.current = null;
        setLive(false);
        return;
      }

      micRef.current = await startMic();
      setLive(true);
    } catch {
      // Denied, unsupported, or no input — the idle animation carries on.
      micRef.current = null;
      setLive(false);
    } finally {
      busy.current = false;
    }
  }, []);

  return (
    <>
      <LedPanel micRef={micRef} theme={theme} />

      <button
        type="button"
        onClick={toggle}
        aria-label={live ? "Stop listening to the room" : "Listen to the room"}
        aria-pressed={live}
        className="absolute inset-0 z-30 cursor-default appearance-none bg-transparent"
      />
    </>
  );
}
