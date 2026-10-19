/** 读取模型目录下的全部 YAML 文件（Node 侧，供 Vite 插件与命令行校验共用） */
import fs from 'node:fs'
import path from 'node:path'
import type { RawFile } from '../src/model/types'

export interface ModelPayload {
  /** 模型目录，相对项目根，仅用于显示 */
  dir: string
  files: RawFile[]
}

export function isModelFile(file: string): boolean {
  return /\.ya?ml$/i.test(file)
}

export function readModelDir(dir: string, projectRoot: string): ModelPayload {
  const files: RawFile[] = []
  const walk = (cur: string) => {
    if (!fs.existsSync(cur)) return
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (isModelFile(ent.name)) files.push({ path: path.relative(dir, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') })
    }
  }
  walk(dir)
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { dir: path.relative(projectRoot, dir) || '.', files }
}

/** ARCH_MODEL_DIR 优先，缺省为项目内 model/h5player（ADR-0001） */
export function resolveModelDir(projectRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(projectRoot, env.ARCH_MODEL_DIR ?? 'model/h5player')
}
