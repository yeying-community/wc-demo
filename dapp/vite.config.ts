import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    nodePolyfills({
      // To exclude specific polyfills, add them to this list.
      exclude: [
        'fs', // Excludes the polyfill for `fs` and `node:fs`.
      ],
      // To add specific polyfills, add them to this list.
      include: ['crypto', 'stream', 'util', 'buffer', 'vm'],
      // Whether to polyfill `node:` protocol imports.
      protocolImports: true,
    }),
  ],
  server: {
    port: 3000,
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
      //external: (id) => id.includes('@libp2p/utils/multiaddr/is-globalThis-unicast'),
      output: {
        manualChunks: {
          'crypto-libs': ['crypto-browserify', 'buffer'],
        }
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    minify: 'terser',
  }
});
