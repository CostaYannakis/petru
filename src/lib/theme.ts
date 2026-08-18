"use client";

import { useCallback, useEffect, useState } from "react";
import { isThemeName, nextTheme, type ThemeName } from "@/lib/palette";
import { useSettings } from "@/lib/settings-store";

const PARAM = "theme";
const CYCLE_KEY = "t";

/** The ramp asked for in the URL, if any. Read once, at first render. */
function fromUrl(): ThemeName | null {
  if (typeof window === "undefined") return null;
  const asked = new URLSearchParams(window.location.search).get(PARAM);
  return isThemeName(asked) ? asked : null;
}

/**
 * The panel's colour identity, live.
 *
 * Three things can decide it, in this order. `?theme=<name>` pins it for that
 * URL, so the schemes can still be compared on the actual hardware by
 * bookmarking two addresses and flicking between them — whatever you are
 * looking at is something you can send to someone else. Otherwise it comes from
 * the settings store, which is what /admin writes to and what survives a
 * reload. Pressing `t` cycles, which is the quicker way to do it at a desk, and
 * lets go of the URL pin so the key keeps working on a pinned address.
 *
 * The name is also written to `<html data-theme>`, which is where globals.css
 * picks up the matching chrome — the diffuser sheen and the orientation gate —
 * so the DOM never sits on a different palette from the canvas.
 */
export function useTheme() {
  const { settings, set } = useSettings();
  const [pinned, setPinned] = useState<ThemeName | null>(fromUrl);

  const theme = pinned ?? settings.theme;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const cycle = useCallback(() => {
    setPinned(null);
    set("theme", nextTheme(theme));
  }, [set, theme]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== CYCLE_KEY || e.metaKey || e.ctrlKey || e.altKey) return;
      cycle();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycle]);

  return { theme, cycle };
}
