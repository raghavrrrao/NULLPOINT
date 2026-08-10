import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const sharedSrc = fileURLToPath(new URL("../shared/src", import.meta.url));

export default defineConfig({
  // `shared` is consumed as TypeScript source through an alias rather than as a
  // built package. Phase 1 has no server, so there is nothing to gain from a
  // separate build step, and this keeps HMR working across the package boundary.
  resolve: {
    alias: [
      { find: /^@nullpoint\/shared$/, replacement: `${sharedSrc}/index.ts` },
      { find: /^@nullpoint\/shared\//, replacement: `${sharedSrc}/` },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2023",
    sourcemap: true,
  },
  // Rapier ships as WASM; the -compat build inlines it, but Vite still needs to
  // leave it alone during dependency pre-bundling.
  optimizeDeps: {
    exclude: ["@dimforge/rapier3d-compat"],
  },
});
