import fs from 'node:fs'
import path from 'node:path'
import type { RawFile } from '../../src/model'

const DIR = path.join(import.meta.dirname, 'sample')

/** 读取 tests/fixtures/sample 下的全部 YAML，可用 overrides 覆盖或追加文件 */
export function sampleFiles(overrides: Record<string, string> = {}): RawFile[] {
  const files = new Map<string, string>()
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (ent.name.endsWith('.yaml')) files.set(path.relative(DIR, full), fs.readFileSync(full, 'utf8'))
    }
  }
  walk(DIR)
  for (const [p, text] of Object.entries(overrides)) files.set(p, text)
  return [...files].map(([p, text]) => ({ path: p, text }))
}
