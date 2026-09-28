import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  // VITE_BASE is the path the site is served from, e.g. "/HifdhTracker/" on GitHub Pages.
  const env = loadEnv(mode, process.cwd(), '');
  return {
  base: env.VITE_BASE || '/',
  resolve: { alias: { '@engine': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: { host: true, fs: { allow: ['..'] } },
  build: { chunkSizeWarningLimit: 900 },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Hifdh Revision',
        short_name: 'Hifdh',
        description: 'Offline Qur’an hifdh revision planner',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F6F2E8',
        theme_color: '#F6F2E8',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        globIgnores: ['mushaf/**'],
        navigateFallback: 'index.html',
        // The 604 page fonts and layouts are cached by the app's offline downloader
        // (lib/offline.js) into this same cache, then always served from it.
        runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.includes('/mushaf/'), handler: 'CacheFirst', options: { cacheName: 'mushaf-v1', matchOptions: { ignoreVary: true } } }],
      },
    }),
  ],
  };
});
