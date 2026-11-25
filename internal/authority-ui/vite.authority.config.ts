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
          return html.replace(/<link([^>]*rel=["']stylesheet["'][^>]*)crossorigin/gi, '<link$1');
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '../../'),
      },
    },
    build: {
      outDir: path.resolve(__dirname, '../../dist-authority'),
      emptyOutDir: false,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'authority.html'),
        }
      }
    }
  };
});
