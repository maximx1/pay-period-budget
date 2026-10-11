import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const apiTarget = `http://localhost:${process.env.API_PORT ?? 8787}`;

export default defineConfig(({ mode }) => {
  // `--mode android` builds the copy that ships inside the phone app. It is not served by
  // the API, so it has to be told where the API is.
  if (mode === "android" && !loadEnv(mode, process.cwd(), "VITE_").VITE_API_BASE_URL) {
    throw new Error("Set VITE_API_BASE_URL in .env.android first (copy .env.android.example).");
  }

  return {
    plugins: [react(), tailwindcss()],
    build: {
      // Kept apart: the Android copy has the API's address baked in and must never be
      // what `npm start` or the Docker image serves.
      outDir: mode === "android" ? "dist/android" : "dist/client",
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
  };
});
