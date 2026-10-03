import { defineConfig } from "vite";

// two pages: the delivery game (index) and the original steering test circuit (track)
export default defineConfig({
  build: { rollupOptions: { input: { index: "index.html", track: "track.html" } } },
});
