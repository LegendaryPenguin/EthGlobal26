import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createContextHandler, createVerifyHandler } from "./server/verify";

const require = createRequire(import.meta.url);
// idkit-core ships its bridge WASM next to its built JS; resolve the package entry (its exports map
// blocks resolving ./package.json) and take the WASM from the same dist dir.
const IDKIT_WASM = path.join(path.dirname(require.resolve("@worldcoin/idkit-core")), "idkit_wasm_bg.wasm");

/// Dev-only middleware for the World ID 4.0 flow (server/verify.ts) + serving idkit's bridge WASM.
function worldId(env: Record<string, string>): Plugin {
  return {
    name: "world-id-v4",
    configureServer(server) {
      const context = createContextHandler(env);
      const verify = createVerifyHandler(env);

      // Serve idkit's WASM with the correct MIME. idkit-core fetches it via
      // `new URL("idkit_wasm_bg.wasm", import.meta.url)`; Vite otherwise returns index.html for it
      // (wrong MIME → WebAssembly.instantiate fails → the World ID bridge dies with "Something went wrong").
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split("?")[0].endsWith("idkit_wasm_bg.wasm")) {
          res.setHeader("Content-Type", "application/wasm");
          createReadStream(IDKIT_WASM).pipe(res);
          return;
        }
        next();
      });

      server.middlewares.use("/api/world/context", (req, res, next) => {
        if (req.method !== "POST") return next();
        context(req, res);
      });
      server.middlewares.use("/api/verify", (req, res, next) => {
        if (req.method !== "POST") return next();
        verify(req, res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), worldId(env)],
    // Keep idkit out of dep pre-bundling so `import.meta.url` resolves next to the real WASM file.
    optimizeDeps: { exclude: ["@worldcoin/idkit", "@worldcoin/idkit-core"] },
  };
});
