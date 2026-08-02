import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: 'index.html',
        app: 'かんたんジェノグラム.html',
        demo: 'かんたんジェノグラム_デモ版.html',
        save1: 'かんたんジェノグラム_save1.html'
      }
    }
  }
});
