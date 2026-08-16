import OrientationGate from "@/components/OrientationGate";
import Visualiser from "@/components/Visualiser";

export default function Home() {
  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-black">
      <Visualiser />

      <div className="diffuser pointer-events-none absolute inset-0 z-10" />

      <OrientationGate />
    </main>
  );
}
