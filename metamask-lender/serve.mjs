// Host-agnostic production server for the lender SPA (Render / Railway / Fly / a VM).
// Serves the built dist/ AND proxies /iris/* -> Circle's Iris attestation API, exactly like the
// Vercel rewrite — so the CCTP attestation polling keeps working off-Vercel (no CORS break).
// Run: npm run build && npm run serve
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const PORT = Number(process.env.PORT || 4173);
const IRIS = process.env.IRIS_API_BASE || "https://iris-api-sandbox.circle.com";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json",
};

const server = createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];

  // --- /iris/* -> Circle Iris (mirrors the Vercel rewrite; fixes browser CORS for CCTP polling) ---
  if (path.startsWith("/iris/")) {
    const target = IRIS + (req.url || "").slice("/iris".length);
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers: { accept: "application/json" },
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.statusCode = upstream.status;
      res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
      res.end(buf);
    } catch (e) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // --- static files with SPA fallback to index.html ---
  let file = normalize(join(DIST, path === "/" ? "index.html" : path));
  if (!file.startsWith(DIST)) { res.statusCode = 403; res.end("forbidden"); return; }
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(DIST, "index.html"); // unknown path -> SPA entry
  }
  try {
    const body = await readFile(file);
    res.setHeader("content-type", MIME[extname(file)] || "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});

server.listen(PORT, () => console.log(`vouch-lender serving dist/ + /iris proxy on :${PORT}`));
