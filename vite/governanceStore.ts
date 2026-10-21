/**
 * 治理存储（Node 侧，docs/architecture/governance.md §3）：项目下 governance/ 的基线与拦截记录。
 * 不属于描述：readModelDir 跳过这个目录（ADR-0015）。基线只由命令行生成（U7）；拦截记录只追加（Q4）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Baseline, LedgerEntry } from '../src/model'
import { GOVERNANCE_DIR } from './readModelDir'

export { GOVERNANCE_DIR }
export const BASELINE_FILE = 'baseline.json'
const LEDGER_FILE = 'ledger.jsonl'
/** 页面只取最近这么多行拦截记录 */
export const LEDGER_PAGE_LIMIT = 2000

export const governanceDir = (modelRoot: string, project: string) => path.join(modelRoot, project, GOVERNANCE_DIR)

export function readBaseline(dir: string): Baseline | null {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(dir, BASELINE_FILE), 'utf8')) as Baseline
    return Array.isArray(b.violations) && b.cyclicity ? b : null
  } catch {
    return null
  }
}

/** U7：键排序、缩进两格，便于评审差异 */
export function writeBaseline(dir: string, baseline: Baseline): string {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, BASELINE_FILE)
  fs.writeFileSync(file, `${JSON.stringify({ ...baseline, violations: [...baseline.violations].sort() }, null, 2)}\n`)
  return file
}

/** Q4：最近 limit 行；坏行跳过 */
export function readLedger(dir: string, limit?: number): LedgerEntry[] {
  let text: string
  try {
    text = fs.readFileSync(path.join(dir, LEDGER_FILE), 'utf8')
  } catch {
    return []
  }
  const lines = text.split('\n').filter(Boolean)
  const out: LedgerEntry[] = []
  for (const l of limit ? lines.slice(-limit) : lines) {
    try {
      out.push(JSON.parse(l) as LedgerEntry)
    } catch {
      /* 坏行跳过 */
    }
  }
  return out
}

export function appendLedger(dir: string, entry: LedgerEntry): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(path.join(dir, LEDGER_FILE), `${JSON.stringify(entry)}\n`)
}

/** U7：源码根目录的 git 提交；不是 git 仓库时为 undefined */
export function sourceCommit(root: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return undefined
  }
}
