import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { archModelPlugin } from './vite/archModelPlugin'
import { resolveModelRoot } from './vite/readModelDir'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [vue(), archModelPlugin({ modelRoot: resolveModelRoot(root), root })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  // npm run build 只做类型检查与打包验证（分块、Worker、按需加载能打成产物），产物不部署：本工具只在本地开发服务器上运行（ADR-0007 修订）
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
    // 单测里最重的源码读取（acceptance 的 h5player 全树解析）实测 ~4.5s，全量并发负载下还会拉伸；
    // 预算给足 20s：红了就是断言红，不是环境负载把默认 5s 挤爆的假红（G9，CLAUDE.md §4）
    testTimeout: 20_000,
  },
})
