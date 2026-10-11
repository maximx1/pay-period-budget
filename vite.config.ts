import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = `http://localhost:${process.env.API_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    // The main bundle is React, the router, the query client and the form and validation
    // libraries: about 530 kB before compression, 165 kB after. Warn only if it grows well past that.
    chunkSizeWarningLimit: 650,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": apiTarget,
    },
  },
});
