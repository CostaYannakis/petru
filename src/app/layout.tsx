import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PETRU",
  description:
    "PETRU, visualised — a dot-matrix LED audio visualiser on smoked black, banded blue through hot pink and orange to ice blue. Built for a phone held sideways.",
  applicationName: "PETRU",
  appleWebApp: {
    capable: true,
    title: "PETRU",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "PETRU",
    description:
      "A dot-matrix LED audio visualiser on smoked black, banded blue through hot pink and orange to ice blue.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Let the canvas run under the notch; the chrome insets itself instead.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full bg-black font-mono">{children}</body>
    </html>
  );
}
