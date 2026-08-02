import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: 'index.html',
        app: 'PDF変換アプリ.html'
      }
    }
  }
});
