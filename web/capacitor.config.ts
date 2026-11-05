import type { CapacitorConfig } from "@capacitor/cli";

// The Android app: the built web app (dist/) runs inside the app, pose model
// included; data, AI and OSRM come from the server the user sets on first start.
const config: CapacitorConfig = {
  appId: "uz.normativai.app",
  appName: "NormativAI",
  webDir: "dist",
  android: {
    // Map tiles may come from a plain-http tile server on the local network.
    allowMixedContent: true,
  },
  plugins: {
    SystemBars: {
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
    },
  },
};

export default config;
