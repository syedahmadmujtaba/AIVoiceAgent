import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      strictPort: true,
      host: 'localhost',
      proxy: { '/api': `http://127.0.0.1:${env.API_PORT || 3001}` },
    },
    plugins: [react(), tailwindcss()],
  };
});
