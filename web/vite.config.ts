import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  resolve: {
    alias: { react: 'preact/compat', 'react-dom': 'preact/compat' },
  },
  build: {
    // iOS 15+ (Telegram на старых айфонах) — без лишних полифиллов.
    target: ['safari15', 'chrome100'],
    cssTarget: ['safari15', 'chrome100'],
    assetsInlineLimit: 0,
  },
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
});
