import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  root: "ui",
  plugins: [solid()],
  build: { outDir: "../dist/ui", emptyOutDir: true },
  // `mise run dev`: the UI dev server forwards API calls to the app container.
  server: { proxy: { "/api": process.env.API_URL ?? "http://app:3000" } },
});
