import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function finderPreviewPlugin() {
  return {
    name: 'finder-preview',
    closeBundle() {
      const outputPath = fileURLToPath(new URL('./dist/index.html', import.meta.url));
      const html = readFileSync(outputPath, 'utf8');
      writeFileSync(outputPath, html.replace('<script type="module" crossorigin', '<script'));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), finderPreviewPlugin()],
  build: {
    rollupOptions: {
      output: {
        format: 'iife',
      },
    },
  },
});
