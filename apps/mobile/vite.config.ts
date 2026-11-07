import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // one React even if the project is reached through a different drive path (e.g. subst L:)
    dedupe: ['react', 'react-dom'],
  },
  server: { port: 5173 },
});
