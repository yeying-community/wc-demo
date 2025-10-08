import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    nodePolyfills({
      exclude: ['fs'],
      include: ['crypto', 'stream', 'util', 'buffer', 'vm'],
      protocolImports: true,
    }),
  ],
  server: {
    port: 3001,
  },
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      'crypto': 'crypto-browserify',
      'stream': 'stream-browserify',
      'util': 'util',
      'vm': 'vm-browserify',
    }
  },
  optimizeDeps: {
    include: ['crypto-browserify', 'stream-browserify', 'util', 'vm-browserify']
  },
  build: {
    rollupOptions: {
      external: (id) => id.includes('@libp2p/utils/multiaddr/is-globalThis-unicast'),
      output: {
        manualChunks: {
          'crypto-libs': ['crypto-browserify', 'buffer'],
        }
      },
    },
    minify: 'terser',
    commonjsOptions: {
      transformMixedEsModules: true
    }
  }
});
