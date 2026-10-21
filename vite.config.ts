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
  build: {
    // elk.bundled（约 1.4MB）只在无 Worker 环境兜底，浏览器不会加载
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // 第三方库按用途成块（ADR-0013）：Vue 运行时一块；画布、Markdown、高亮各一块，随项目视图按需加载
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@vue-flow')) return 'vue-flow'
          if (/node_modules\/(@vue\/|vue\/|vue-router\/)/.test(id)) return 'vue'
          if (id.includes('markdown-it') || id.includes('mdurl') || id.includes('linkify-it') || id.includes('uc.micro') || id.includes('entities'))
            return 'markdown'
          if (
            id.includes('shiki/') ||
            id.includes('@shikijs/core') ||
            id.includes('@shikijs/engine') ||
            id.includes('@shikijs/types') ||
            id.includes('oniguruma')
          )
            return 'highlight'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
