import { defineConfig } from "vite";

// two pages: the delivery game (index) and the original steering test circuit (track)
// base "./": the build works from any sub-path (GitHub Pages serves it at /last-mile/)
export default defineConfig({
  base: "./",
  build: { rollupOptions: { input: { index: "index.html", track: "track.html" } } },
});
