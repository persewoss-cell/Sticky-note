import { defineConfig } from 'vite';

// base './' 로 빌드해야 Electron(app://)과 웹 호스팅 모두에서 동작합니다.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
});
