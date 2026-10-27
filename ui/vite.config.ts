import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The on-device model is compiled in only with KRISH_LOCAL_MODEL=1 (see SECURITY.md: it conflicts with the
// "no remote code loading" rule, so it is an explicit opt-in at build time).
export default defineConfig({
  plugins: [react()],
  define: {
    __KRISH_LOCAL_MODEL__: JSON.stringify(process.env.KRISH_LOCAL_MODEL === "1"),
    __KRISH_VERSION__: JSON.stringify(process.env.KRISH_VERSION ?? "dev"),
  },
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", sourcemap: false },
});
