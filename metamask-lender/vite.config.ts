import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Standalone, fully-mocked MetaMask Portfolio replica for the Vouch lender flow.
// No backend, no wallet — every interaction is local state.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(process.cwd(), "src") } },
  server: {
    port: 5273,
    // Proxy Circle's CCTP attestation API to avoid browser CORS during the live bridge.
    proxy: {
      "/iris": {
        target: "https://iris-api-sandbox.circle.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/iris/, ""),
      },
    },
  },
  preview: { port: 4173 },
});
