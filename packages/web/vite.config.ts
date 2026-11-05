import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { VitePWA } from 'vite-plugin-pwa';

/** Data files live in public/<dataDir>/ (default "data"; "data-fixture" for the hand-written fixture). */
const DATA_RE = /\/data(?:-[a-z0-9]+)?\//;

export default defineConfig({
  // Relative base: the build works from any sub-path / static host.
  base: './',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered manually in src/main.tsx (production only)
      includeAssets: ['icons/*.svg', 'icons/*.png'],
      manifest: {
        name: 'Українсько-англійський словник · Ukrainian–English Dictionary',
        short_name: 'Словник',
        description: 'Offline Ukrainian–English dictionary with inflection tables, stress marks and English full-text search.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f7f6f3',
        theme_color: '#1f4e8c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // App shell only; data files are cached at runtime (and by the search worker's prefetch).
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['data/**', 'data-*/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [DATA_RE],
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => DATA_RE.test(url.pathname) && url.pathname.endsWith('/manifest.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'ukdict-manifest', networkTimeoutSeconds: 4 },
          },
          {
            // Content-hashed, immutable → cache first. Same cache name as the worker's prefetch.
            urlPattern: ({ url }) => DATA_RE.test(url.pathname) && url.pathname.endsWith('.json.gz'),
            handler: 'CacheFirst',
            options: { cacheName: 'ukdict-data', cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'upload.wikimedia.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'ukdict-audio',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 300 },
            },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2023',
    // Never inline the worker; keep chunks readable in size reports.
    assetsInlineLimit: 0,
    reportCompressedSize: true,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
