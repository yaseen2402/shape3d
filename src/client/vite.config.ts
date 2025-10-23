import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [],
  build: {
    outDir: '../../dist/client',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
