"use client";

import { useState } from "react";
import Visualiser from "@/components/Visualiser";
import { DEFAULTS, GROUPS, type Field, type Settings } from "@/lib/settings";
import { useSettings } from "@/lib/settings-store";

/**
 * The bench.
 *
 * Every value the panel is tuned by, with the panel itself running beside them
 * off the same store — so a slider is not a form field that gets submitted, it
 * is the thing itself moving. The preview is the real `Visualiser`, not a
 * simplified stand-in: same engine, same microphone path, same ballistics, just
 * in a box. Tuning against an approximation would be pointless.
 *
 * Changes reach three places, in widening circles: this page immediately, every
 * other tab on the origin over a BroadcastChannel, and — where a shared store is
 * configured — the deployed panel itself within a few seconds. The last of those
 * is why the page is behind a password.
 */
export default function SettingsDashboard() {
  const { settings, set, reset, remote } = useSettings();
  const [copied, setCopied] = useState(false);

  const changed = (Object.keys(DEFAULTS) as (keyof Settings)[]).filter(
    (key) => settings[key] !== DEFAULTS[key],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(settings, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard permission. The values are all on screen anyway.
    }
  }

  return (
    <div className="mx-auto grid max-w-[1500px] gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
      <div className="top-6 flex flex-col gap-4 lg:sticky">
        <div>
          <h1 className="text-lg font-bold tracking-[0.2em] text-peak">
            PETRU — BENCH
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-mid">
            The panel below is the real one. Tap it to give it the microphone.
          </p>
          <p className="mt-2 text-[0.7rem] leading-relaxed text-dim">
            {remote === true
              ? "Live: changes are written to the shared store and every panel on this deployment follows within a few seconds."
              : remote === false
                ? "Local only: no shared store is configured, so changes stay in this browser and reach other tabs on this origin."
                : "Checking for a shared store…"}
          </p>
        </div>

        {/*
          A landscape box, because that is what the composition assumes — the
          same aspect a phone gives on its side.
        */}
        <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-dim/30 bg-black">
          <Visualiser />
          <div className="diffuser pointer-events-none absolute inset-0 z-10" />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[0.7rem]">
          <button
            type="button"
            onClick={reset}
            className="rounded border border-dim/40 px-3 py-1.5 uppercase tracking-widest text-dim transition-colors hover:border-hot hover:text-hot"
          >
            Reset all
          </button>
          <button
            type="button"
            onClick={copy}
            className="rounded border border-dim/40 px-3 py-1.5 uppercase tracking-widest text-dim transition-colors hover:border-hot hover:text-hot"
          >
            {copied ? "Copied" : "Copy JSON"}
          </button>
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="rounded border border-dim/40 px-3 py-1.5 uppercase tracking-widest text-dim transition-colors hover:border-hot hover:text-hot"
          >
            Open panel ↗
          </a>
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/admin/session", { method: "DELETE" });
              location.reload();
            }}
            className="rounded border border-dim/40 px-3 py-1.5 uppercase tracking-widest text-dim transition-colors hover:border-hot hover:text-hot"
          >
            Sign out
          </button>
          <span className="ml-auto tabular-nums text-mid">
            {changed.length === 0
              ? "stock tuning"
              : `${changed.length} changed from default`}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {GROUPS.map((group) => (
          <section
            key={group.title}
            className="rounded-lg border border-dim/25 bg-white/[0.02] p-4"
          >
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-hot">
              {group.title}
            </h2>
            <p className="mt-1 max-w-prose text-[0.7rem] leading-relaxed text-mid">
              {group.blurb}
            </p>

            <div className="mt-4 flex flex-col gap-4">
              {group.fields.map((field) => (
                <Control
                  key={field.key}
                  field={field}
                  settings={settings}
                  set={set}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

type Setter = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

function Control({
  field,
  settings,
  set,
}: {
  field: Field;
  settings: Settings;
  set: Setter;
}) {
  const value = settings[field.key];
  const isDefault = value === DEFAULTS[field.key];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={field.key}
          className={`text-xs ${isDefault ? "text-mid" : "text-peak"}`}
        >
          {field.label}
          {/* A value off the default is worth spotting at a glance when you
              come back to a panel you tuned last week. */}
          {isDefault ? null : <span className="ml-1.5 text-hot">•</span>}
        </label>

        {field.kind === "number" ? (
          <input
            id={`${field.key}-value`}
            type="number"
            value={settings[field.key]}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) set(field.key, next);
            }}
            className="w-24 rounded border border-dim/30 bg-black px-2 py-0.5 text-right text-xs tabular-nums text-peak outline-none focus:border-hot"
          />
        ) : null}
      </div>

      {field.kind === "number" ? (
        <input
          id={field.key}
          type="range"
          value={settings[field.key]}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(e) => set(field.key, Number(e.target.value))}
          className="mt-1.5 h-1 w-full cursor-pointer appearance-none rounded bg-dim/30 accent-hot"
        />
      ) : null}

      {field.kind === "toggle" ? (
        <div className="mt-1">
          <input
            id={field.key}
            type="checkbox"
            checked={settings[field.key]}
            onChange={(e) => set(field.key, e.target.checked)}
            className="h-4 w-4 accent-hot"
          />
        </div>
      ) : null}

      {field.kind === "choice" ? (
        <select
          id={field.key}
          // Keyed off the field rather than hardwired to the palette — there is
          // more than one choice on this page now.
          value={settings[field.key]}
          onChange={(e) =>
            set(field.key, e.target.value as Settings[typeof field.key])
          }
          className="mt-1.5 w-full rounded border border-dim/30 bg-black px-2 py-1 text-xs text-peak outline-none focus:border-hot"
        >
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : null}

      <p className="mt-1.5 text-[0.65rem] leading-relaxed text-dim">
        {field.note}
      </p>
    </div>
  );
}
