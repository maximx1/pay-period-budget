import { defineConfig } from "vite";

// Builds the MCP server and everything it imports into one file that needs only Node to
// run: `npm run build:mcp` → dist/mcp/ppb-mcp.mjs.
export default defineConfig({
  // No public/ folder to copy next to it.
  publicDir: false,
  build: {
    ssr: "mcp/server.ts",
    outDir: "dist/mcp",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: {
      output: { entryFileNames: "ppb-mcp.mjs", banner: "#!/usr/bin/env node" },
    },
  },
  // Bundle the dependencies too; only Node's own modules stay as imports.
  ssr: { noExternal: true },
});
