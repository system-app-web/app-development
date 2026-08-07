import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: 'index.html',
        app: 'app.html',
        demo: 'demo.html',
        backup: 'backup.html'
      }
    }
  }
});
