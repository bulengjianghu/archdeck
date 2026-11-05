/**
 * 设计说明与编号表的读写（DA-10、CI-2；DL-3、DL-10）：都在设计目录下、AI / 页面拥有、不登记指纹（人拥有指纹门禁不含它们，04 §1）。
 * 读在 readModelDir（草图版本的载荷带上编号表与设计说明）。
 * - 设计说明 `designs/<设计>/notes/<名>.md`：好的对话回答「存为设计说明」，头部几行写标题、模块、状态「目标态 · 未实现」与时间；随设计归档后原样可开。
 * - 编号表 `designs/<设计>/changes.json`：页面维护（保存草图时一并写），号撤回留空不复用。
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseChangeTable } from '../src/model'
import { DESIGNS_DIR, isProjectId } from './readModelDir'
import { WriteError, projectDir } from './writeModel'

export const NOTES_DIR = 'notes'
export const CHANGES_FILE = 'changes.json'

const designDir = (modelRoot: string, project: string, design: string) => {
  if (!isProjectId(design)) throw new WriteError(`设计名不合法：${design}`)
  const dir = path.join(projectDir(modelRoot, project), DESIGNS_DIR, design)
  if (!fs.existsSync(path.join(dir, 'design.yaml'))) throw new WriteError(`设计不存在：${design}`)
  return dir
}

/** 文件名：标题里能用的字母数字与汉字，其余成 -；同名时加序号 */
function noteName(dir: string, title: string): string {
  const base =
    title
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'note'
  for (let i = 1; ; i++) {
    const name = `${i === 1 ? base : `${base}-${i}`}.md`
    if (!fs.existsSync(path.join(dir, name))) return name
  }
}

/** DL-10：存为设计说明 */
export function saveNote(
  modelRoot: string,
  project: string,
  design: string,
  input: { title?: unknown; text?: unknown; module?: unknown },
): { ok: true; file: string } {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (!title || !text) throw new WriteError('设计说明要有标题与正文')
  if (text.length > 64 * 1024) throw new WriteError('设计说明太长（上限 64 KB）')
  const module = typeof input.module === 'string' && /^[\w.:-]+$/.test(input.module) ? input.module : undefined
  const dir = path.join(designDir(modelRoot, project, design), NOTES_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const name = noteName(dir, title)
  const head = [`# ${title}`, '', `> 目标态 · 未实现${module ? ` · 模块 ${module}` : ''} · ${new Date().toISOString()}`, '']
  fs.writeFileSync(path.join(dir, name), `${head.join('\n')}\n${text}\n`)
  return { ok: true, file: `${NOTES_DIR}/${name}` }
}

/** DL-3：写编号表（保存草图时一并写） */
export function writeChangeTable(modelRoot: string, project: string, design: string, table: unknown): void {
  const file = path.join(designDir(modelRoot, project, design), CHANGES_FILE)
  fs.writeFileSync(file, `${JSON.stringify(parseChangeTable(table), null, 2)}\n`)
}
