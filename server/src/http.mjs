import fs from "node:fs";
import path from "node:path";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      const keys = [];
      const regex = new RegExp(
        `^${pattern.replace(/:(\w+)/g, (_, k) => {
          keys.push(k);
          return "([^/]+)";
        })}/?$`,
      );
      routes.push({ method, regex, keys, handler });
    },
    match(method, pathname) {
      let pathMatched = false;
      for (const r of routes) {
        const m = pathname.match(r.regex);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        return { handler: r.handler, params };
      }
      return pathMatched ? { methodNotAllowed: true } : null;
    },
  };
}

export async function readJson(req, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "So'rov juda katta");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON noto'g'ri");
  }
}

export function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(data);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".tflite": "application/octet-stream",
  ".woff2": "font/woff2",
};

/** Serves the built web app; unknown paths get index.html so the app's own routes work. */
export function serveStatic(root, req, res, pathname) {
  if (!fs.existsSync(root)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Web ilova qurilmagan: `npm run build` ni ishga tushiring (yoki `npm run dev` bilan oching).");
    return;
  }
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = path.join(root, safe);
  if (!file.startsWith(root)) file = path.join(root, "index.html");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  const ext = path.extname(file);
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}
