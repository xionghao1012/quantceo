import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

export default defineConfig({
  plugins: [
    vue(),
  ],
  root: 'src/client',
  envDir: resolve(__dirname),
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: resolve(__dirname, 'prod/client'),
    // outDir 在 root 之外，Vite 默认不清空 → 旧 hash 的 chunk 会一直留在
    // 产物目录里（既撑大镜像，旧 bundle 里的敏感串也还能被直接访问）
    emptyOutDir: true,
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
    proxy: {
      '/api': `http://localhost:${process.env.VITE_API_PORT || '3001'}`,
      // 收款码图片由 API 服务托管（生产同源；dev 需要代理，否则 404 变破图）
      '/payment-qr': `http://localhost:${process.env.VITE_API_PORT || '3001'}`,
      '/api/sso/admin': `http://localhost:${process.env.VITE_SSO_PORT || '3002'}`,
    }
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
