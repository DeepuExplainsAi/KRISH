import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: { __KRISH_LOCAL_MODEL__: "false" },
  base: "./",
  build: { outDir: "dist-harness", emptyOutDir: true, target: "es2022", rollupOptions: { input: "harness.html" } },
});
