import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vitest/config";

// HTTPS=1 npm run dev: a self-signed certificate, so phones on the same
// network can open the camera and GPS pages while developing.
const https = process.env.HTTPS === "1";
const api = process.env.API_URL ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react(), ...(https ? [basicSsl()] : [])],
  server: {
    host: true,
    // ../shared holds the GPS maths the server uses too.
    fs: { allow: [".."] },
    proxy: { "/api": { target: api, changeOrigin: true } },
  },
  preview: {
    host: true,
    proxy: { "/api": { target: api, changeOrigin: true } },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
