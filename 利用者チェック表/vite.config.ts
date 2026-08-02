import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: 'index.html',
        app: '利用者チェック表.html'
      }
    }
  }
});
