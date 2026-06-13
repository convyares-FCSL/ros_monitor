import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    // The RosIntrospection route chunk is large because it bundles Three.js, but
    // it is lazy-loaded only when that page opens. Raise the warning threshold so
    // the build is clean; the initial bundle is now ~160 kB.
    chunkSizeWarningLimit: 800,
  },
});
