import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { archModelPlugin } from './vite/archModelPlugin'
import { resolveModelDir } from './vite/readModelDir'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  // 相对路径，构建产物可部署在任意子路径
  base: './',
  plugins: [vue(), archModelPlugin({ dir: resolveModelDir(root), root })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
