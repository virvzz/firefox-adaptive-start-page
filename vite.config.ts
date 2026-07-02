import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

// Custom plugin to copy manifest and icons from public to dist root
function copyPublicAssets() {
  return {
    name: 'copy-public-assets',
    closeBundle() {
      const dist = path.resolve(__dirname, 'dist');
      const pub = path.resolve(__dirname, 'public');

      if (!existsSync(dist)) mkdirSync(dist, { recursive: true });

      // Copy manifest.json
      const manifestSrc = path.join(pub, 'manifest.json');
      const manifestDst = path.join(dist, 'manifest.json');
      if (existsSync(manifestSrc)) {
        copyFileSync(manifestSrc, manifestDst);
      }

      // Copy icons directory
      const iconsSrc = path.join(pub, 'icons');
      const iconsDst = path.join(dist, 'icons');
      if (existsSync(iconsSrc)) {
        if (!existsSync(iconsDst)) mkdirSync(iconsDst, { recursive: true });
        readdirSync(iconsSrc).forEach((file: string) => {
          copyFileSync(path.join(iconsSrc, file), path.join(iconsDst, file));
        });
      }

      // Move newtab.html from src/newtab/ to dist root
      const htmlSrc = path.join(dist, 'src', 'newtab', 'index.html');
      const htmlDst = path.join(dist, 'newtab.html');
      if (existsSync(htmlSrc)) {
        copyFileSync(htmlSrc, htmlDst);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyPublicAssets()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: '',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        newtab: path.resolve(__dirname, 'src/newtab/index.html'),
        background: path.resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});