// Host-agnostic PRODUCTION server for the borrower app. The Vite dev middleware (vite.config.ts)
// only runs under `vite dev`; this serves the built SPA (dist/) + the identity-first World ID API
// in production on ANY Node host (Render / Railway / Fly / a VM). Run: `npm run build && npm run serve`.
//
// Env (server-side only — never VITE_ prefixed): WORLD_RP_SIGNING_KEY, RELAYER_PRIVATE_KEY, plus the
// VITE_* addresses (VITE_LOAN_REGISTRY_ADDRESS, VITE_LOAN_VAULT_ADDRESS, VITE_PASSPORT_REGISTRY_ADDRESS,
// VITE_ARC_RPC_URL, VITE_WORLD_APP_ID, VITE_WORLD_RP_ID). PORT defaults to 8080.
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSessionContextHandler, createSigninHandler, createClaimHandler, createApplyHandler, createDecisionHandler } from "./verify.js";
import { createMarketHandler } from "./marketEngine.js";
import { createLinkWalletHandler } from "./walletLink.js";
import { createAttestationHandler } from "./attestation.js";
import { createRepayHandler } from "./repay.js";

const require = createRequire(import.meta.url);
const IDKIT_WASM = path.join(path.dirname(require.resolve("@worldcoin/idkit-core")), "idkit_wasm_bg.wasm");
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const PORT = Number(process.env.PORT || 8080);
const env = process.env as Record<string, string>;

const sessionContext = createSessionContextHandler(env);
const signin = createSigninHandler(env);
const claim = createClaimHandler(env);
const apply = createApplyHandler(env);
const decision = createDecisionHandler(env);
const market = createMarketHandler(env);
const linkWallet = createLinkWalletHandler(env);
const attestation = createAttestationHandler(env);
const repay = createRepayHandler(env);

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];

  // World ID identity-first API (same routes as the dev middleware).
  if (req.method === "POST" && url === "/api/world/session-context") return sessionContext(req, res);
  if (req.method === "POST" && url === "/api/world/signin") return signin(req, res);
  if (req.method === "POST" && url === "/api/world/claim") return claim(req, res);
  if (req.method === "POST" && url === "/api/world/apply") return apply(req, res);
  if (req.method === "POST" && url === "/api/world/decision") return decision(req, res);
  if (url === "/api/market") return market(req, res); // GET reads rates, POST advances the market
  if (req.method === "POST" && url === "/api/world/link-wallet") return linkWallet(req, res);
  if (url === "/api/attestation") return attestation(req, res); // GET ?id=...
  if (url === "/api/world/repay") return repay(req, res); // GET schedule, POST pay installment

  // idkit bridge WASM with the correct MIME (else the World App bridge dies).
  if (url.endsWith("idkit_wasm_bg.wasm")) {
    res.setHeader("Content-Type", "application/wasm");
    return createReadStream(IDKIT_WASM).pipe(res);
  }

  // Static SPA with history-fallback to index.html.
  let file = path.join(DIST, url === "/" ? "index.html" : url.replace(/^\/+/, ""));
  if (!existsSync(file) || !file.startsWith(DIST)) file = path.join(DIST, "index.html");
  try {
    const body = await readFile(file);
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(PORT, () => console.log(`Vouch borrower app (SPA + World ID API) on :${PORT}`));
