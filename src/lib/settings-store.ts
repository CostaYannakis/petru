"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  cleanSettings,
  DEFAULTS,
  type Settings,
} from "@/lib/settings";

/**
 * The live tuning, and everything that keeps copies of it in agreement.
 *
 * There are up to three places a value can come from, and they are layered so
 * that the panel never has to care which:
 *
 *   1. the defaults, always
 *   2. localStorage, so a reload keeps what you were doing
 *   3. the shared store behind /api/settings, when one is configured
 *
 * Where a shared store exists — on the deployed device — it wins, and the local
 * copy becomes a cache of it. That is the whole point of a live dashboard: the
 * bench and the panel in the room are looking at the same numbers, and the
 * panel is the one that has to be right.
 *
 * State lives outside React because the consumer is a requestAnimationFrame
 * loop, not a component. React reads the same store through
 * `useSyncExternalStore`, so the dashboard re-renders and the panel doesn't.
 */

const KEY = "petru.settings";

/**
 * How often the panel asks the shared store whether anything moved.
 *
 * Deliberately not as fast as it could be. A panel left running is a poll that
 * never stops — at five seconds that is seventeen thousand reads a day, which
 * is enough to matter against a free key-value quota, and the device is not so
 * impatient that four seconds of lag on a slider spoils anything. A hidden tab
 * stops asking entirely, so a phone in a pocket costs nothing.
 */
const POLL_MS = 4_000;

/** Slider drags fire continuously; the network should not. */
const PUSH_MS = 250;

let current: Settings = { ...DEFAULTS };

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

/** Null until the first reply from /api/settings says whether one exists. */
let remote: boolean | null = null;

/**
 * The live settings, for code that runs outside React.
 *
 * Call it *inside* the frame rather than hoisting the result: the object is
 * replaced on every change, and a reference captured when the panel was set up
 * would go on describing the tuning it started with.
 */
export function settings() {
  return current;
}

/** Whether a shared store is answering. Null while we are still asking. */
export function remoteAvailable() {
  return remote;
}

export function subscribeSettings(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode, or a full quota. The settings still work for this session.
  }
}

/** Apply without echoing back out, for changes that arrived from somewhere else. */
function adopt(patch: Partial<Settings>) {
  const next = { ...current, ...patch };

  // Cheap identity check, so a poll that changed nothing does not wake every
  // subscriber four times a minute forever.
  let same = true;
  for (const key of Object.keys(next) as (keyof Settings)[]) {
    if (next[key] !== current[key]) {
      same = false;
      break;
    }
  }
  if (same) return;

  current = next;
  persist();
  notify();
}

// --- pushing to the shared store --------------------------------------------

let pending: Partial<Settings> = {};
let pushTimer: ReturnType<typeof setTimeout> | undefined;

async function flush() {
  const body = pending;
  pending = {};
  if (Object.keys(body).length === 0) return;

  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    // 401 means the admin session lapsed mid-session. The change stays local,
    // and the next poll will pull the shared values back over it — which is
    // the honest outcome: it did not take.
    if (!res.ok) return;
  } catch {
    // Offline. Same story.
  }
}

function push(patch: Partial<Settings>) {
  if (remote !== true) return;

  pending = { ...pending, ...patch };
  clearTimeout(pushTimer);
  pushTimer = setTimeout(flush, PUSH_MS);
}

// --- writing ----------------------------------------------------------------

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  if (current[key] === value) return;

  current = { ...current, [key]: value };
  persist();
  channel?.postMessage({ [key]: value });
  push({ [key]: value } as Partial<Settings>);
  notify();
}

export function resetSettings() {
  current = { ...DEFAULTS };
  persist();
  channel?.postMessage(DEFAULTS);
  push({ ...DEFAULTS });
  notify();
}

let pollTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Ask the shared store what it has, adopt it, and book the next ask.
 *
 * Defined above the startup block below on purpose, and `pollTimer` with it.
 * `poll` is a hoisted declaration and would happily be *called* from anywhere,
 * but `pollTimer` is a `let` — calling poll() before that line has run puts its
 * first statement in the temporal dead zone, which throws inside an async
 * function, which becomes a rejected promise, which a bare call discards
 * without a word. The symptom is not an error; it is a store that silently
 * never syncs.
 */
async function poll() {
  clearTimeout(pollTimer);
  if (document.hidden) return;

  try {
    const res = await fetch("/api/settings", { cache: "no-store" });
    const body = (await res.json()) as {
      remote?: boolean;
      settings?: unknown;
    };

    const was = remote;
    remote = body.remote === true;
    if (was !== remote) notify();

    // Only adopt when there is actually a shared store. Otherwise the reply is
    // just telling us we are on our own, and localStorage is the authority.
    if (remote && body.settings) adopt(cleanSettings(body.settings));
  } catch {
    // Leave `remote` as it was; a dropped poll is not evidence of anything.
  }

  // Keep asking even when there is no shared store: one may appear the moment
  // the environment gains the keys, without the page being reloaded.
  pollTimer = setTimeout(poll, POLL_MS);
}

// --- startup ----------------------------------------------------------------

if (typeof window !== "undefined") {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) current = { ...current, ...cleanSettings(JSON.parse(stored)) };
  } catch {
    // Unparseable. Defaults it is.
  }

  // So the bench can sit in one window and the panel in another, on a second
  // screen, and the sliders still drive it — with no round trip at all.
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel(KEY);
    channel.addEventListener("message", (event) =>
      adopt(cleanSettings(event.data)),
    );
  }

  void poll();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void poll();
  });
}

// --- React ------------------------------------------------------------------

/**
 * Server-rendered markup is always the defaults, because neither localStorage
 * nor the shared store exists there; the store syncs on the client immediately
 * after.
 */
export function useSettings() {
  const value = useSyncExternalStore(
    subscribeSettings,
    settings,
    () => DEFAULTS,
  );

  const shared = useSyncExternalStore(
    subscribeSettings,
    remoteAvailable,
    () => null,
  );

  const set = useCallback(
    <K extends keyof Settings>(key: K, next: Settings[K]) =>
      setSetting(key, next),
    [],
  );

  return { settings: value, set, reset: resetSettings, remote: shared };
}
