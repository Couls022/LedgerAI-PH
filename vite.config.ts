import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'html-transform-clean-stylesheet-crossorigin',
        transformIndexHtml(html) {
          // Remove crossorigin from link rel="stylesheet" to prevent browser CORS/privacy blocking on local assets
          return html.replace(/<link([^>]*rel=["']stylesheet["'][^>]*)crossorigin/gi, '<link$1');
        },
      },
    ],
    resolve: {
      dedupe: ['react', 'react-dom', 'react-router-dom'],
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      sourcemap: false,
      emptyOutDir: false, // Retain prior hashed bundles during hot updates so open tabs never 404
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: false,
      watch: null,
      allowedHosts: true as const,
    },
  };
});
