import fs from 'node:fs'
import path from 'node:path'
import type { RawFile } from '../../src/model'

const DIR = path.join(import.meta.dirname, 'sample')
const SCENARIO_DIR = path.join(import.meta.dirname, 'scenario')

function readDir(root: string, files: Map<string, string>) {
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (/\.(yaml|json)$/.test(ent.name)) files.set(path.relative(root, full), fs.readFileSync(full, 'utf8'))
    }
  }
  walk(root)
}

/** 读取 tests/fixtures/sample 下的全部描述文件，可用 overrides 覆盖或追加文件 */
export function sampleFiles(overrides: Record<string, string> = {}): RawFile[] {
  const files = new Map<string, string>()
  readDir(DIR, files)
  for (const [p, text] of Object.entries(overrides)) files.set(p, text)
  return [...files].map(([p, text]) => ({ path: p, text }))
}

/** 样例 + 外部参与者与场景（tests/fixtures/scenario）：sc.play（含 alt、loop、ref、参与者）与 sc.decide（JSON） */
export function scenarioFiles(overrides: Record<string, string> = {}): RawFile[] {
  const files = new Map<string, string>()
  readDir(DIR, files)
  readDir(SCENARIO_DIR, files)
  for (const [p, text] of Object.entries(overrides)) files.set(p, text)
  return [...files].map(([p, text]) => ({ path: p, text }))
}
