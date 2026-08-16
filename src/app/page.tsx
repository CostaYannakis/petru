import LedPanel from "@/components/LedPanel";
import OrientationGate from "@/components/OrientationGate";

export default function Home() {
  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-smoked">
      <LedPanel />

      <div className="diffuser pointer-events-none absolute inset-0 z-10" />

      {/* Chrome stays out of the panel's way — inset from the notch and the
          home indicator, both on the short edges once the phone is sideways. */}
      <div
        className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between"
        style={{
          paddingTop: "max(0.8rem, env(safe-area-inset-top))",
          paddingBottom: "max(0.8rem, env(safe-area-inset-bottom))",
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
        }}
      >
        <header className="flex items-start justify-between">
          <span className="flex items-center gap-2 text-[9px] uppercase tracking-[0.38em] text-amber/55">
            <span className="blink-led block h-1 w-1 rounded-[1px] bg-orange" />
            Now playing
          </span>
          <span className="text-[9px] uppercase tracking-[0.38em] text-ember/60">
            Petru
          </span>
        </header>

        <footer className="flex items-end justify-end">
          <span className="text-[9px] uppercase tracking-[0.3em] text-ember/45">
            hold sideways
          </span>
        </footer>
      </div>

      <OrientationGate />
    </main>
  );
}
