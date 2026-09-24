import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // В dev фронт ходит на свой же origin, а Vite переправляет на прокси.
      // Благодаря этому в DevTools видно ровно то же, что будет в проде:
      // запрос на /api/chat и ни одного обращения к openrouter.ai.
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
