import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createContextHandler, createVerifyHandler } from "./server/verify";

/// Dev-only middleware for the World ID 4.0 flow (server/verify.ts). Keeps the RP signing key +
/// relayer key server-side. POST /api/world/context mints a signed rp_context; POST /api/verify
/// verifies the v4 proof with World and mints the passport.
function worldId(env: Record<string, string>): Plugin {
  return {
    name: "world-id-v4",
    configureServer(server) {
      const context = createContextHandler(env);
      const verify = createVerifyHandler(env);
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
  // loadEnv with "" prefix returns ALL vars (incl. non-VITE server secrets).
  const env = loadEnv(mode, process.cwd(), "");
  return { plugins: [react(), worldId(env)] };
});
