import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

declare const process: { env: Record<string, string | undefined> };

const runNumber = process.env.GITHUB_RUN_NUMBER;
const appVersion = runNumber
  ? `V1.${String(runNumber).padStart(2, '0')}`
  : 'V1.dev';

export default defineConfig({
  base: '/fictional-plot/',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Fictional Plot',
        short_name: 'Plot',
        description: 'Architectural survey maker',
        theme_color: '#f6f7fb',
        background_color: '#f6f7fb',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
});
