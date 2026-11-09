/**
 * 重讲落盘（DA-4、DA-5，DL-8）：agent 的重讲块经模型层判别（三问 + 同一套题解检查）放行后，由架构台写——
 * 题解 HTML 写进 explainers/（盖上现在的依据指纹，与 `npm run arch -- explainer <模块> --write` 同一个写法），
 * 讲法要求累积写进 explainers/<模块 ID>.notes.md（AI 拥有、不登记指纹，不进 arch-basis）。AI 自己不写任何文件。
 * 只碰这两个文件；描述 YAML、规则、确认记录、草图一概不碰。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  explainerStatus,
  formatBasis,
  formatNotes,
  judgeRenarrate,
  loadModel,
  mergeNotes,
  notesPath,
  parseNotes,
  writeBasisMeta,
  type RenarrateBlock,
} from '../src/model'
import { readProject } from './readModelDir'

export type RenarrateOutcome = { applied: true; path: string; notes: string[] } | { applied: false; reasons: string[] }

/** 已有的讲法要求（没有文件为空） */
export function readNotes(modelRoot: string, project: string, module: string): string[] {
  const file = path.join(modelRoot, project, notesPath(module))
  return fs.existsSync(file) ? parseNotes(fs.readFileSync(file, 'utf8')) : []
}

/** 重讲一轮的收尾：anchor 是发问时的锚点模块，产出的模块必须是它 */
export function applyRenarrate(modelRoot: string, project: string, projectRoot: string, anchor: string, block: RenarrateBlock): RenarrateOutcome {
  const payload = readProject(modelRoot, project, projectRoot)
  if (!payload) return { applied: false, reasons: [`项目不存在：${project}`] }
  const { index } = loadModel(payload.files)
  const reasons: string[] = []
  if (block.module !== anchor) reasons.push(`重讲的是「${anchor}」，产出却指向「${block.module}」`)
  const pre = judgeRenarrate(index, block)
  if (!pre.ok) return { applied: false, reasons: [...reasons, ...pre.reasons] }
  if (reasons.length) return { applied: false, reasons }
  const rel = pre.path
  const candidate = loadModel([...payload.files.filter(f => f.path !== rel), { path: rel, text: block.html }]).index
  const verdict = judgeRenarrate(index, block, candidate)
  if (!verdict.ok) return { applied: false, reasons: verdict.reasons }
  // 盖依据：与 arch explainer --write 同一个写法（EX-6、EX-9）
  const st = explainerStatus(candidate, block.module)
  const html = st ? writeBasisMeta(block.html, formatBasis(st.current)) : block.html
  const dir = path.join(modelRoot, project)
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  const notes = mergeNotes(readNotes(modelRoot, project, block.module), block.notes)
  fs.writeFileSync(path.join(dir, notesPath(block.module)), formatNotes(block.module, notes))
  fs.writeFileSync(path.join(dir, rel), html)
  return { applied: true, path: rel, notes }
}
