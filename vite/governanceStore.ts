/**
 * 治理存储（Node 侧，docs/architecture/governance.md §3）：项目下 governance/ 的基线与拦截记录。
 * 不属于描述：readModelDir 跳过这个目录（ADR-0015）。基线只由命令行生成（U7）；拦截记录只追加（Q4）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { SKETCHES_DIR, isOwnedFile, type Baseline, type LedgerEntry, type OwnedRecord } from '../src/model'
import { DESIGNS_DIR, GOVERNANCE_DIR, isModelFile } from './readModelDir'

export { GOVERNANCE_DIR }
export const BASELINE_FILE = 'baseline.json'
const LEDGER_FILE = 'ledger.jsonl'
/** X6：人拥有文件的指纹 */
export const OWNED_FILE = 'owned.json'
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

// ── X6：人拥有文件的指纹 ──

export function readOwned(dir: string): OwnedRecord | null {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, OWNED_FILE), 'utf8')) as OwnedRecord
    return r && typeof r.files === 'object' && r.files ? r : null
  } catch {
    return null
  }
}

/** 键排序、缩进两格，便于评审差异 */
export function writeOwned(dir: string, record: OwnedRecord): string {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, OWNED_FILE)
  const files = Object.fromEntries(Object.entries(record.files).sort(([a], [b]) => a.localeCompare(b)))
  fs.writeFileSync(file, `${JSON.stringify({ updatedAt: record.updatedAt, files }, null, 2)}\n`)
  return file
}

export const ownedFingerprint = (text: string): string => createHash('sha1').update(text).digest('hex')

/** 项目下人拥有的文件（isOwnedFile，含 designs/<设计>/ 下的草图与元信息）及其指纹：路径相对项目描述目录 */
export function ownedHashes(projectDir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const add = (rel: string) => {
    if (isOwnedFile(rel)) out[rel] = ownedFingerprint(fs.readFileSync(path.join(projectDir, rel), 'utf8'))
  }
  if (!fs.existsSync(projectDir)) return out
  for (const ent of fs.readdirSync(projectDir, { withFileTypes: true })) {
    if (ent.isFile() && isModelFile(ent.name)) add(ent.name)
    else if (ent.isDirectory() && ent.name === 'intent') for (const f of fs.readdirSync(path.join(projectDir, 'intent'))) add(`intent/${f}`)
    else if (ent.isDirectory() && ent.name === DESIGNS_DIR)
      for (const d of fs.readdirSync(path.join(projectDir, DESIGNS_DIR), { withFileTypes: true })) {
        if (!d.isDirectory()) continue
        for (const f of fs.readdirSync(path.join(projectDir, DESIGNS_DIR, d.name), { withFileTypes: true })) {
          if (f.isFile()) add(`${DESIGNS_DIR}/${d.name}/${f.name}`)
          // X9：设计的草图 designs/<设计>/sketches/<mount>.yaml
          else if (f.isDirectory() && f.name === SKETCHES_DIR)
            for (const g of fs.readdirSync(path.join(projectDir, DESIGNS_DIR, d.name, SKETCHES_DIR))) add(`${DESIGNS_DIR}/${d.name}/${SKETCHES_DIR}/${g}`)
        }
      }
  }
  return out
}

/** 命令行 arch own：把全部人拥有文件的指纹写进 owned.json（只由人执行） */
export function registerOwned(modelRoot: string, project: string, at = new Date().toISOString()): { file: string; files: string[] } {
  const files = ownedHashes(path.join(modelRoot, project))
  const file = writeOwned(governanceDir(modelRoot, project), { updatedAt: at, files })
  return { file, files: Object.keys(files).sort() }
}

/** 写入端点写完一个人拥有的文件后更新它的指纹；没有 owned.json 时新建、只含这一项（其余待人登记） */
export function touchOwned(modelRoot: string, project: string, rel: string, at = new Date().toISOString()): void {
  if (!isOwnedFile(rel)) return
  const dir = governanceDir(modelRoot, project)
  const prev = readOwned(dir)
  const full = path.join(modelRoot, project, rel)
  const files = { ...(prev?.files ?? {}) }
  if (fs.existsSync(full)) files[rel] = ownedFingerprint(fs.readFileSync(full, 'utf8'))
  else delete files[rel]
  writeOwned(dir, { updatedAt: at, files })
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
