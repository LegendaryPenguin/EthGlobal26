import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createVerifyHandler } from "./server/verify";

/// Dev-only middleware: exposes POST /api/verify so the World ID proof is verified server-side
/// (relayer key stays out of the browser). See server/verify.ts.
function worldIdVerify(env: Record<string, string>): Plugin {
  return {
    name: "world-id-verify",
    configureServer(server) {
      const handler = createVerifyHandler(env);
      server.middlewares.use("/api/verify", (req, res, next) => {
        if (req.method !== "POST") return next();
        handler(req, res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // loadEnv with "" prefix returns ALL vars (incl. non-VITE server secrets like RELAYER_PRIVATE_KEY).
  const env = loadEnv(mode, process.cwd(), "");
  return { plugins: [react(), worldIdVerify(env)] };
});
