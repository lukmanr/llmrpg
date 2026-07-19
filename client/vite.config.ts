import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Keep in sync with PORTS in shared/src/config.ts. The Vite config is loaded
// by node before Vite's TS transform exists, so it cannot import the raw-TS
// @llmrpg/shared workspace like app code does.
const PORTS = { CLIENT: 4001, LLMRPG_SERVER: 4002, SKILLSHOP: 5173 } as const;

export default defineConfig({
  plugins: [react()],
  server: {
    port: PORTS.CLIENT,
    strictPort: true,
    proxy: {
      // Specific SkillShop routes first, then catch-all to llmrpg server.
      '/api/agent': {
        target: `http://localhost:${PORTS.SKILLSHOP}`,
        changeOrigin: true,
        ws: true,
      },
      '/api/chat': {
        target: `http://localhost:${PORTS.SKILLSHOP}`,
        changeOrigin: true,
      },
      '/api/auth': {
        target: `http://localhost:${PORTS.SKILLSHOP}`,
        changeOrigin: true,
      },
      '/api/settings': {
        target: `http://localhost:${PORTS.SKILLSHOP}`,
        changeOrigin: true,
      },
      '/api': {
        target: `http://localhost:${PORTS.LLMRPG_SERVER}`,
        changeOrigin: true,
      },
    },
  },
});
