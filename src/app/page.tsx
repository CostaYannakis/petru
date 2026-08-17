import NowPlayingCard from "@/components/NowPlayingCard";
import OrientationGate from "@/components/OrientationGate";
import Visualiser from "@/components/Visualiser";

export default function Home() {
  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-black">
      <Visualiser />

      <div className="diffuser pointer-events-none absolute inset-0 z-10" />

      {/*
        Over the diffuser, not under it: the sheen belongs on the LEDs, and
        laying it across a record sleeve would be an overlay on the artwork.
      */}
      <NowPlayingCard />

      <OrientationGate />
    </main>
  );
}
