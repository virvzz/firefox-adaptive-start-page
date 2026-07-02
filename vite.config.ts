import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';

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

// AMO flags React DOM's unused innerHTML runtime branches in the bundled file.
// The app never renders <script> or dangerouslySetInnerHTML, so release builds
// disable those branches to keep the package review surface quiet.
function stripReactDomUnsafeInnerHtmlBranches() {
  return {
    name: 'strip-react-dom-unsafe-inner-html-branches',
    closeBundle() {
      const bundlePath = path.resolve(__dirname, 'dist', 'newtab.js');
      if (!existsSync(bundlePath)) return;

      let code = readFileSync(bundlePath, 'utf8');
      const replacements = [
        {
          label: 'React script element innerHTML bootstrap',
          expectedCount: 1,
          from: 'case`script`:o=s.createElement(`div`),o.innerHTML=`<script><\\/script>`,o=o.removeChild(o.firstChild);break;',
          to: 'case`script`:o=s.createElement(`script`);break;',
        },
        {
          label: 'React dangerouslySetInnerHTML assignment',
          expectedCount: 2,
          from: 'case`dangerouslySetInnerHTML`:if(r!=null){if(typeof r!=`object`||!(`__html`in r))throw Error(i(61));if(n=r.__html,n!=null){if(a.children!=null)throw Error(i(60));e.innerHTML=n}}break;',
          to: 'case`dangerouslySetInnerHTML`:if(r!=null)throw Error(`dangerouslySetInnerHTML is disabled in this extension`);break;',
        },
      ];

      for (const replacement of replacements) {
        const count = code.split(replacement.from).length - 1;
        if (count !== replacement.expectedCount) {
          throw new Error(
            `${replacement.label}: expected ${replacement.expectedCount} occurrence(s), found ${count}.`
          );
        }
        code = code.split(replacement.from).join(replacement.to);
      }

      if (/\.\s*innerHTML\s*=/.test(code)) {
        throw new Error('Release bundle still contains an innerHTML assignment.');
      }

      writeFileSync(bundlePath, code, 'utf8');
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyPublicAssets(), stripReactDomUnsafeInnerHtmlBranches()],
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
