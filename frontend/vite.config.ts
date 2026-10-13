import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { assetsInlineLimit: 0 },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:5000" },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:5000" },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./tests/setup.ts",
    restoreMocks: true,
    clearMocks: true,
  },
});
