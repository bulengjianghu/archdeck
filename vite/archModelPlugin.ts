/**
 * ModelSource：把模型目录下的 YAML 交给页面。
 * - 开发态：GET /model.json 实时读取；文件变化时推送 `arch-model:changed`；
 * - 构建态：把全部文件固化为产物中的 model.json。
 * 只搬运原始文本，解析与校验都在页面侧的模型层完成，保证两种形态报错一致。
 */
import path from 'node:path'
import type { Plugin } from 'vite'
import { isModelFile, readModelDir } from './readModelDir'

export const MODEL_CHANGED_EVENT = 'arch-model:changed'
export const MODEL_FILE = 'model.json'

export function archModelPlugin(options: { dir: string; root: string }): Plugin {
  const { dir, root } = options
  const inDir = (file: string) => {
    const rel = path.relative(dir, file)
    return !rel.startsWith('..') && !path.isAbsolute(rel) && isModelFile(file)
  }
  return {
    name: 'h5p-arch-desk:model-source',
    configureServer(server) {
      server.watcher.add(dir)
      let timer: ReturnType<typeof setTimeout> | undefined
      server.watcher.on('all', (_event, file) => {
        if (!inDir(file)) return
        // AI 重新生成时会连续写多个文件，合并成一次通知
        clearTimeout(timer)
        timer = setTimeout(() => server.ws.send({ type: 'custom', event: MODEL_CHANGED_EVENT }), 150)
      })
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== `/${MODEL_FILE}`) return next()
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(readModelDir(dir, root)))
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: MODEL_FILE, source: JSON.stringify(readModelDir(dir, root)) })
    },
  }
}
