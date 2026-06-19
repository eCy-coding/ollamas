import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // vF4 — PWA / iOS web-clip (adopted from vite-pwa/vite-plugin-pwa, MIT).
      // Auto-injects SW registration; offline shell for the cockpit on Mac + iOS.
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['pwa-icon.svg'],
        manifest: {
          name: 'ollamas — LLM Mission Control',
          short_name: 'ollamas',
          description: 'Regional MCP gateway + tools-as-SaaS cockpit',
          theme_color: '#0b0d12',
          background_color: '#0b0d12',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          icons: [
            {src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any'},
            {src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable'},
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,woff2}'],
          navigateFallback: '/index.html',
          // Telemetry is live data: try network first, fall back to last-known.
          runtimeCaching: [
            {
              urlPattern: ({url}) => url.pathname === '/api/health',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'ollamas-health',
                networkTimeoutSeconds: 3,
                expiration: {maxEntries: 8, maxAgeSeconds: 60},
              },
            },
          ],
        },
        devOptions: {enabled: false},
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // vF7 — multi-page: the React SPA (app) + the vanilla alt-lane landing/embed
    // demo. public/embed.js is copied verbatim (zero-build, embeddable anywhere).
    build: {
      rollupOptions: {
        input: {
          app: path.resolve(__dirname, 'index.html'),
          landing: path.resolve(__dirname, 'web/index.html'),
          embedDemo: path.resolve(__dirname, 'web/embed-demo.html'),
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
