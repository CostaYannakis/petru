"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_THEME,
  isThemeName,
  nextTheme,
  type ThemeName,
} from "@/lib/palette";

const PARAM = "theme";
const CYCLE_KEY = "t";

function fromUrl(): ThemeName {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const asked = new URLSearchParams(window.location.search).get(PARAM);
  return isThemeName(asked) ? asked : DEFAULT_THEME;
}

/**
 * The panel's colour identity, live.
 *
 * `DEFAULT_THEME` is what the device ships as. `?theme=<name>` overrides it, so
 * the schemes can be compared on the actual hardware — bookmark two URLs and
 * flick between them — and pressing `t` cycles, which is the quicker way to do
 * it at a desk. Nothing is persisted: the URL is the whole state, so what you
 * are looking at is always something you can send to someone else.
 *
 * The name is also written to `<html data-theme>`, which is where globals.css
 * picks up the matching chrome — the diffuser sheen and the orientation gate —
 * so the DOM never sits on a different palette from the canvas.
 */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeName>(fromUrl);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const cycle = useCallback(() => setTheme(nextTheme), []);

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
