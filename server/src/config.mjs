import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT_DIR = path.resolve(SERVER_DIR, "..");

// server/.env is optional; real environment variables win over it.
const envFile = path.join(SERVER_DIR, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = (name, fallback) => {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
};

function parseCenter(text) {
  const [lat, lon] = String(text).split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : { lat: 41.3111, lon: 69.2797 };
}

const resolveFromServer = (p) => (p ? path.resolve(SERVER_DIR, p) : p);

export function loadConfig() {
  return {
    host: env("HOST", "0.0.0.0"),
    port: Number(env("PORT", 8080)),
    httpsCert: resolveFromServer(env("HTTPS_CERT", "")),
    httpsKey: resolveFromServer(env("HTTPS_KEY", "")),
    dataDir: resolveFromServer(env("DATA_DIR", "var")),
    webDist: path.join(ROOT_DIR, "web", "dist"),
    ai: {
      // Any OpenAI-compatible endpoint: DeepSeek, or a local Ollama / llama.cpp / vLLM.
      baseUrl: env("AI_BASE_URL", "https://api.deepseek.com").replace(/\/+$/, ""),
      apiKey: env("AI_API_KEY", ""),
      model: env("AI_MODEL", "deepseek-v4-pro"),
      timeoutMs: Number(env("AI_TIMEOUT_MS", 180000)),
      maxTokens: Number(env("AI_MAX_TOKENS", 6000)),
      jsonMode: env("AI_JSON_MODE", "true") !== "false",
    },
    osrm: {
      baseUrl: env("OSRM_URL", "http://127.0.0.1:5000").replace(/\/+$/, ""),
      profile: env("OSRM_PROFILE", "foot"),
      chunkSize: Number(env("OSRM_MATCH_CHUNK", 100)),
      timeoutMs: Number(env("OSRM_TIMEOUT_MS", 15000)),
    },
    map: {
      tileUrl: env("TILE_URL", "https://tile.openstreetmap.org/{z}/{x}/{y}.png"),
      tileAttribution: env("TILE_ATTRIBUTION", "© OpenStreetMap"),
      center: parseCenter(env("MAP_CENTER", "41.3111,69.2797")),
    },
  };
}
