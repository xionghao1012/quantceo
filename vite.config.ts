import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
  ],
  root: 'src/client',
  build: {
    outDir: resolve(__dirname, 'dist/client'),
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers', 'vue-echarts'],
        },
      },
    },
  },
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: { '/api': 'http://localhost:4001' }
  },
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  css: {
    postcss: './postcss.config.js',
  },
  test: {
    include: ['src/server/__tests__/**/*.test.ts'],
    root: resolve(__dirname),
  },
})
