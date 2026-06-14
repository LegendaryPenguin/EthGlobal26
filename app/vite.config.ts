import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createSessionContextHandler, createSigninHandler, createClaimHandler, createApplyHandler, createDecisionHandler } from "./server/verify";
import { createMarketHandler } from "./server/marketEngine";
import { createLinkWalletHandler } from "./server/walletLink";
import { createAttestationHandler } from "./server/attestation";

const require = createRequire(import.meta.url);
const IDKIT_WASM = path.join(path.dirname(require.resolve("@worldcoin/idkit-core")), "idkit_wasm_bg.wasm");

/// Dev-only middleware for the identity-first World ID 4.0 flow (server/verify.ts) + serving idkit's
/// bridge WASM. The RP signing key / relayer / managed-wallet secret all stay server-side.
function worldId(env: Record<string, string>): Plugin {
  const post = (handler: (req: any, res: any) => void) => (req: any, res: any, next: any) => {
    if (req.method !== "POST") return next();
    handler(req, res);
  };
  return {
    name: "world-id-v4",
    configureServer(server) {
      // Serve idkit's bridge WASM with the correct MIME (else Vite returns index.html → bridge dies).
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split("?")[0].endsWith("idkit_wasm_bg.wasm")) {
          res.setHeader("Content-Type", "application/wasm");
          createReadStream(IDKIT_WASM).pipe(res);
          return;
        }
        next();
      });
      server.middlewares.use("/api/world/session-context", post(createSessionContextHandler(env)));
      server.middlewares.use("/api/world/signin", post(createSigninHandler(env)));
      server.middlewares.use("/api/world/claim", post(createClaimHandler(env)));
      server.middlewares.use("/api/world/apply", post(createApplyHandler(env)));
      server.middlewares.use("/api/world/decision", post(createDecisionHandler(env)));
      // GET = read live rates; POST = advance the simulated market + push on-chain. Both handled inside.
      server.middlewares.use("/api/market", createMarketHandler(env));
      server.middlewares.use("/api/world/link-wallet", post(createLinkWalletHandler(env)));
      server.middlewares.use("/api/attestation", createAttestationHandler(env)); // GET ?id=...
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Server-side modules (e.g. server/cre.ts) read process.env directly — that's populated on Vercel
  // but NOT by loadEnv in dev. Mirror the .env files into process.env (without clobbering real ones)
  // so the same code path runs locally and in prod.
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
  return {
    plugins: [react(), worldId(env)],
    // bb.js ships its own wasm + workers. Keep it out of the dep pre-bundler (which mangles the
    // wasm/worker resolution) and target esnext for the top-level await it uses. We deliberately do
    // NOT set COOP/COEP headers (which would break the cross-origin World ID widget) — bb.js then
    // runs single-threaded in the browser, which is fine for a single eligibility proof.
    optimizeDeps: { exclude: ["@aztec/bb.js", "@noir-lang/noir_js"] },
    worker: { format: "es" },
    build: { target: "esnext" },
    esbuild: { target: "esnext" },
  };
});
