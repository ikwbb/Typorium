import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  // Relative base so the build works from any sub-path (GitHub Pages, a static host folder, ...).
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { host: "127.0.0.1", port: 5173 },
  build: { target: "es2022", chunkSizeWarningLimit: 4096 },
  plugins: [
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icons/*.svg", "icons/*.png"],
      manifest: {
        id: "./",
        name: "Typorium",
        short_name: "Typorium",
        description: "A Typora-style WYSIWYG Markdown editor.",
        start_url: "./",
        scope: "./",
        display: "standalone",
        display_override: ["window-controls-overlay", "standalone"],
        orientation: "any",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        categories: ["productivity", "utilities"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
        file_handlers: [
          { action: "./", accept: { "text/markdown": [".md", ".markdown", ".mdown", ".mkd"], "text/plain": [".txt"] } },
        ],
        launch_handler: { client_mode: ["navigate-existing", "auto"] },
        shortcuts: [{ name: "New Document", url: "./?new", icons: [{ src: "icons/icon-192.png", sizes: "192x192" }] }],
      } as Record<string, unknown>,
      workbox: {
        // Everything is precached so the editor (MathJax fonts, Mermaid, languages) works offline.
        globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2,json}"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
});
