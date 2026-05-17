import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * navigatr frontend — Vite config.
 *
 * PWA is configured here in full per Session 3. In **dev mode** the service
 * worker is intentionally NOT registered (vite-plugin-pwa's default behavior
 * with no `devOptions.enabled`) — that matches the playbook note that PWA
 * features only activate on built/preview output. Use `pnpm build && pnpm
 * --filter app preview` to exercise install + offline cache locally.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false, // src/pwa.ts owns registration so we control update UX
      includeAssets: [
        "favicon.svg",
        "favicon.ico",
        "robots.txt",
        "apple-touch-icon.png",
      ],
      workbox: {
        // Clean takeover on update — Session 3 keeps this aggressive because
        // there's no persistent client state yet. Revisit before launch if
        // we add in-flight workflows that should survive a SW swap.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Don't precache the giant maskable icon — only ship it when needed.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
        globIgnores: ["**/maskable-icon-512.png"],
        runtimeCaching: [
          // ---- API calls — Network First with a short timeout, so users
          //       get fresh data when online but fall back to cache when not.
          {
            urlPattern: ({ url, sameOrigin }) =>
              (sameOrigin && url.pathname.startsWith("/api/")) ||
              /\bapi\.navigatr\.(app|io|com|dev)$/.test(url.hostname) ||
              (url.hostname === "localhost" && url.port === "5000"),
            handler: "NetworkFirst",
            method: "GET",
            options: {
              cacheName: "navigatr-api",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // ---- Assets (images, fonts, CSS) — Cache First, long TTL.
          {
            urlPattern: ({ request }) =>
              ["image", "font", "style"].includes(request.destination),
            handler: "CacheFirst",
            options: {
              cacheName: "navigatr-assets",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // ---- Bunny Fonts (Inter, JetBrains Mono) — Cache First, 1-year TTL.
          {
            urlPattern: /^https:\/\/fonts\.bunny\.net\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "bunny-fonts",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "navigatr",
        short_name: "navigatr",
        description: "The mobile-first sales platform for field reps",
        theme_color: "#2456E6",
        background_color: "#F7F8FB",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        lang: "en",
        categories: ["business", "productivity"],
        icons: [
          { src: "/icons/icon-72x72.png", sizes: "72x72", type: "image/png", purpose: "any" },
          { src: "/icons/icon-96x96.png", sizes: "96x96", type: "image/png", purpose: "any" },
          { src: "/icons/icon-128x128.png", sizes: "128x128", type: "image/png", purpose: "any" },
          { src: "/icons/icon-144x144.png", sizes: "144x144", type: "image/png", purpose: "any" },
          { src: "/icons/icon-152x152.png", sizes: "152x152", type: "image/png", purpose: "any" },
          { src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-384x384.png", sizes: "384x384", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/maskable-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Bundle splitting — each large vendor goes into its own chunk so it
    // caches independently across deploys (changing app code doesn't bust
    // the Radix chunk, etc.) and the initial parse cost is spread across
    // parallel network requests instead of one big blocking bundle.
    //
    // Strategy:
    //   - react-core: react + react-dom + router (loaded on every page)
    //   - radix:       all @radix-ui packages (Dialog, Select, Tabs, etc.)
    //   - tanstack:    react-query + devtools
    //   - supabase:    @supabase/supabase-js (only used by auth code)
    //   - libphone:    libphonenumber-js — ships country metadata, ~150KB
    //                  gzipped. Splitting it lets the rest of the app
    //                  hydrate before this lands.
    //   - icons:       lucide-react — tree-shaken in theory but the import
    //                  graph is wide; isolating helps caching
    //   - form:        react-hook-form + @hookform/resolvers + zod
    //   - date:        date-fns
    //
    // Anything not matched falls into the main chunk (app code + small
    // utility deps like clsx, tailwind-merge, cva, sonner, zustand).
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react-router") || id.includes("/react-dom/") || /\/node_modules\/react\//.test(id)) {
            return "react-core";
          }
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("@tanstack")) return "tanstack";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("libphonenumber-js")) return "libphone";
          if (id.includes("/leaflet/") || id.includes("react-leaflet") || id.includes("@react-leaflet")) {
            return "leaflet";
          }
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("react-hook-form") || id.includes("@hookform") || id.includes("/zod/")) {
            return "form";
          }
          if (id.includes("date-fns")) return "date";
          return undefined; // everything else in main
        },
      },
    },
    // Bump the warning threshold since with route lazy-loading + vendor
    // splits we expect every chunk under 500KB. Anything above that is
    // a real signal worth investigating.
    chunkSizeWarningLimit: 500,
  },
  server: {
    // Bind both IPv4 and IPv6 (and the LAN IP, for PWA testing on a real
    // phone over Wi-Fi). Without this Vite binds IPv6-only on Node 17+
    // because its default `host: "localhost"` resolves to ::1 first under
    // Node's ipv6-first DNS order — which breaks 127.0.0.1, some VPNs,
    // and IPv4-only loopback consumers like iOS simulators.
    host: true,
    port: 5173,
    strictPort: false,
  },
});
