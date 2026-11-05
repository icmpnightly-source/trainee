import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { createApp } from "./app.mjs";
import { loadConfig } from "./config.mjs";
import { openDb } from "./db.mjs";

const config = loadConfig();
const db = openDb(config.dataDir);
const handler = createApp(config, db);

// Phones only give the camera and GPS to pages served over HTTPS (or localhost).
const tls = config.httpsCert && config.httpsKey;
const server = tls
  ? https.createServer({ cert: fs.readFileSync(config.httpsCert), key: fs.readFileSync(config.httpsKey) }, handler)
  : http.createServer(handler);

server.listen(config.port, config.host, () => {
  const scheme = tls ? "https" : "http";
  console.log(`Trainee: ${scheme}://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`);
  console.log(`  AI:   ${config.ai.baseUrl} (model: ${db.getSetting("ai_model") || config.ai.model})${config.ai.apiKey ? "" : " — AI_API_KEY yo'q"}`);
  console.log(`  OSRM: ${config.osrm.baseUrl}`);
  console.log(`  Ma'lumotlar: ${config.dataDir}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close();
    db.raw.close();
    process.exit(0);
  });
}
