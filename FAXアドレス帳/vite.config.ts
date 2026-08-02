import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: 'index.html',
        app: 'FAXアドレス帳.html'
      }
    }
  }
});
