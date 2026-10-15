import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // ESM-safe alias: no __dirname, so this type-checks under the build's
    // `tsc --noEmit` step and behaves correctly on Windows as well as POSIX.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // pdf.js and jsxgraph are large; split them into their own chunks so the
    // initial bundle stays reasonable on mobile.
    rollupOptions: {
      output: {
        manualChunks: {
          pdf: ['pdfjs-dist'],
          math: ['mathlive', 'jsxgraph'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
