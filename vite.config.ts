import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { archModelPlugin } from './vite/archModelPlugin'
import { resolveModelRoot } from './vite/readModelDir'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  // 相对路径，构建产物可部署在任意子路径
  base: './',
  plugins: [vue(), archModelPlugin({ modelRoot: resolveModelRoot(root), root })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  // elk.bundled（约 1.4MB）只在无 Worker 环境兜底，浏览器不会加载
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
