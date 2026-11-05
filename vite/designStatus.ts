/**
 * 设计状态的写入（DL-32、DL-33，TK-1，ADR-0063 决策 2）：POST /write/<项目>/designs/<设计>/status，正文 `{ action, sketches? }`。
 * - 认可（accept）：正文带页面读取时的各张草图指纹，与磁盘逐张比且张数相同（= 已保存、认可的就是人看过的那一份），
 *   在磁盘草图上重跑校验（格式错误与语义提示都拦，X14）；通过后 status: accepted、approval: { at, sketches: 指纹 }。
 * - 回到起草（withdraw）：status: draft、approval 去掉指纹、记 withdrawnAt（任务单据此标「认可已撤回」）。
 * - 放弃（abandon）：status: abandoned，approval 不动。
 * 去向与拒绝原因只由模型层的迁移表（designTransition）给；design.yaml 用 YAML 文档模型改、写后更新指纹（X6，SK-3）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { isMap } from 'yaml'
import {
  designTransition,
  isSketchFile,
  load,
  loadModel,
  sketchLifetime,
  validateSketch,
  type DesignAction,
  type DesignStatus,
  type SketchDef,
} from '../src/model'
import { DESIGNS_DIR, designSketches, isProjectId, readDesignInfo, readModelDir, sketchHash } from './readModelDir'
import { WriteError, openDoc, projectDir, save, today, type WriteResult } from './writeModel'
import { WriteConflict } from './writeSketch'

export interface DesignStatusRequest {
  action: DesignAction
  /** 认可：页面读取时各张草图的指纹（键为相对设计目录的路径 sketches/<挂载点>.yaml） */
  sketches?: Record<string, string>
}

export interface DesignStatusResult extends WriteResult {
  status: DesignStatus
}

/** 设计目录下各张草图此刻的指纹（键：相对设计目录的路径），与认可记录同一口径（DL-35） */
export function designSketchHashes(projectDirAbs: string, design: string): Record<string, string> {
  const prefix = `${DESIGNS_DIR}/${design}/`
  return Object.fromEntries(designSketches(projectDirAbs, design).map(({ file }) => [file.path.slice(prefix.length), sketchHash(file.text)]))
}

/** 磁盘上的设计草图逐张校验（与按设计写回同一上下文）：格式错误与语义提示 */
function validateOnDisk(dir: string, root: string, design: string): { errors: string[]; hints: string[] } {
  const all = readModelDir(dir, root).files
  const persistent = load(all.filter(f => isSketchFile(f.path))).model.sketches.filter(s => sketchLifetime(s) === 'persistent')
  const index = loadModel(all).index
  const defs: Record<string, SketchDef> = {}
  for (const { file } of designSketches(dir, design)) {
    const s = load([file]).model.sketches[0]
    if (s) defs[s.def.mount] = s.def
  }
  const errors: string[] = []
  const hints: string[] = []
  for (const [mount, def] of Object.entries(defs)) {
    const v = validateSketch(def, { persistent, index, file: `${DESIGNS_DIR}/${design}/sketches/${mount}.yaml`, design: defs })
    errors.push(...v.errors.map(e => `「${mount}」${e.message}`))
    hints.push(...v.warnings.map(e => `「${mount}」${e.message}`))
  }
  return { errors, hints }
}

/** DL-32、DL-33：改设计状态（认可 / 回到起草 / 放弃）；归档另走 archiveDesign */
export function setDesignStatus(modelRoot: string, project: string, design: string, req: DesignStatusRequest, root: string): DesignStatusResult {
  const dir = projectDir(modelRoot, project)
  if (!isProjectId(design)) throw new WriteError('设计 ID 不合法')
  const designDir = path.join(dir, DESIGNS_DIR, design)
  const file = path.join(designDir, 'design.yaml')
  if (!fs.existsSync(file)) throw new WriteError(`设计不存在：${design}`)
  const action = req?.action
  if (action !== 'accept' && action !== 'withdraw' && action !== 'abandon')
    throw new WriteError('action 只能是 accept / withdraw / abandon（归档另走 archive）')
  const info = readDesignInfo(designDir, design)
  const now = designSketchHashes(dir, design)
  let ctx = {}
  if (action === 'accept' && (info.status === 'draft' || info.status === 'reviewing')) {
    if (!Object.keys(now).length) throw new WriteError(`设计「${design}」没有草图，没有可认可的意图`)
    const seen = req.sketches && typeof req.sketches === 'object' ? req.sketches : {}
    const same = Object.keys(seen).length === Object.keys(now).length && Object.entries(now).every(([f, h]) => seen[f] === h)
    if (!same) throw new WriteConflict('草图文件与页面读到的不一致（有未保存的改动，或文件已在外部改动）：重新加载后再认可')
    const v = validateOnDisk(dir, root, design)
    ctx = { saved: true, errors: v.errors.length, firstError: v.errors[0], hints: v.hints.length, firstHint: v.hints[0] }
  }
  const t = designTransition(info.status, action, ctx)
  if (!t.ok) throw new WriteError(t.reason)
  const doc = openDoc(file, '')
  if (!isMap(doc.get('design'))) throw new WriteError('design.yaml 缺少顶层键 design')
  doc.setIn(['design', 'status'], t.to)
  if (action === 'accept') {
    const node = doc.createNode({ at: today(), sketches: now })
    doc.setIn(['design', 'approval'], node)
  } else if (action === 'withdraw') {
    doc.setIn(['design', 'approval'], doc.createNode({ ...(info.approval?.at ? { at: info.approval.at } : {}), withdrawnAt: today() }))
  }
  return { ...save(file, doc, root, modelRoot, project), status: t.to }
}
