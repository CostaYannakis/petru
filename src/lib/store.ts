import { Redis } from "@upstash/redis";
import { cleanSettings, DEFAULTS, type Settings } from "@/lib/settings";

/**
 * The shared tuning, for the device rather than for a laptop.
 *
 * One key holding one small object. This is configuration read constantly and
 * written by one person occasionally, which is what a key-value store is for —
 * and specifically why it is not Edge Config, whose writes are quota-limited
 * and propagate in seconds. Dragging a slider is a write per frame until it is
 * debounced, and even debounced it is nothing a config store wants.
 *
 * Absent env vars are a supported state, not an error: without them the app is
 * simply local-only, the bench writes to localStorage, and /api/settings says
 * so. That is what a fresh clone does before anything is provisioned.
 */

const KEY = "petru:settings";

let client: Redis | null = null;

/**
 * Whether a shared store is configured at all. Read from the environment on
 * every call rather than cached, because the answer changes the first time the
 * integration injects its variables.
 */
export function storeConfigured() {
  // Both spellings, and in this order, because that is exactly what
  // `Redis.fromEnv()` does — the Vercel Marketplace injects the `KV_` pair,
  // while a hand-configured Upstash database uses the `UPSTASH_` one. Checking
  // only the names in the SDK's own documentation would report "no store" on a
  // deployment that has one.
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  return Boolean(url && token);
}

/**
 * Built on first use, never at module load. A top-level `Redis.fromEnv()` would
 * throw during `next build`, which runs before any of this is provisioned.
 */
function redis() {
  if (!client) client = Redis.fromEnv();
  return client;
}

/** The shared settings, or null if there is no shared store to read. */
export async function readShared(): Promise<Settings | null> {
  if (!storeConfigured()) return null;

  try {
    const stored = await redis().get(KEY);
    // A key that has never been written is not a failure — it is a device
    // running the tuning that shipped.
    return { ...DEFAULTS, ...cleanSettings(stored) };
  } catch {
    // Unreachable or misconfigured. The panel keeps whatever it already has
    // rather than being yanked back to defaults by a network blip.
    return null;
  }
}

/** Merge a patch into the shared settings. Returns the result, or null. */
export async function writeShared(
  patch: Partial<Settings>,
): Promise<Settings | null> {
  if (!storeConfigured()) return null;

  const clean = cleanSettings(patch);
  if (Object.keys(clean).length === 0) return readShared();

  try {
    const before = (await readShared()) ?? DEFAULTS;
    const after = { ...before, ...clean };
    await redis().set(KEY, after);
    return after;
  } catch {
    return null;
  }
}
