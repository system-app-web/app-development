import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: 'index.html',
        app: '文言テンプレート.html',
        staff: '文言テンプレート_スタッフ用.html'
      }
    }
  }
});
