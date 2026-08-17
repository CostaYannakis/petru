import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Development only. `next dev` initialises on `localhost` and blocks
   * cross-origin requests for its own assets, so a panel opened on
   * `http://127.0.0.1` gets the HTML and none of the JavaScript — no canvas, no
   * card, no obvious reason why.
   *
   * Spotify will not accept `localhost` as a redirect URI and will accept the
   * loopback address, so 127.0.0.1 is where the panel has to be opened. This is
   * the line that lets those two facts coexist.
   */
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
