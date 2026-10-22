/**
 * 草图写回（B6、X7i，ADR-0024）：人拥有的草图整份写回与新建设计，写回只经这一处。
 * 整份写回的顺序：比对读取时的文件指纹（不符拒绝，409）→ 以持久草图为上下文跑 validateSketch（有 error 拒绝，422）→
 * 用 YAML 文档模型合并（映射逐键、带 id 的列表按 id 对齐、标量值变了才替换；注释只在未改动的节点上保留）→ 写回并更新指纹（X6）→ 拦截记录一行。
 * 文档的打开与保存与追加写入共用（writeModel.ts 的 openDoc / save）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { isMap, isScalar, isSeq, stringify, type Document, type Node } from 'yaml'
import {
  isSketchFile,
  load,
  sketchLifetime,
  sketchText,
  validateSketch,
  type SketchDef,
  type SketchEntity,
  type SketchTarget,
  type SketchValidation,
} from '../src/model'
import { DESIGNS_DIR, SKETCH_FILE, isProjectId, readModelDir, sketchHash } from './readModelDir'
import { appendLedger, governanceDir, touchOwned } from './governanceStore'
import { WriteError, openDoc, projectDir, save, today } from './writeModel'

/** 文件已在外部改动（409） */
export class WriteConflict extends WriteError {}

/** 草图校验不过（422），附问题列表 */
export class SketchInvalid extends WriteError {
  constructor(
    message: string,
    readonly validation: SketchValidation,
  ) {
    super(message)
  }
}

export interface SaveSketchRequest {
  target: SketchTarget
  sketch: SketchDef
  /** 读取时的文件指纹 */
  baseHash: string
}

/** 目标草图文件（相对项目描述目录） */
function targetFile(target: SketchTarget): string {
  if (target?.kind === 'design' && isProjectId(target.design)) return `${DESIGNS_DIR}/${target.design}/${SKETCH_FILE}`
  if (target?.kind === 'persistent' && isProjectId(target.id)) return `intent/${target.id}.yaml`
  throw new WriteError('草图目标不合法')
}

/** 磁盘上的持久草图（校验的上下文） */
function persistentSketches(dir: string, root: string): SketchEntity[] {
  const files = readModelDir(dir, root).files.filter(f => isSketchFile(f.path))
  return load(files).model.sketches.filter(s => sketchLifetime(s) === 'persistent')
}

function check(sketch: SketchDef, persistent: readonly SketchEntity[], file: string): void {
  const v = validateSketch(sketch, { persistent, file })
  if (!v.ok)
    throw new SketchInvalid(
      `草图校验不过（${v.issues.filter(i => i.severity === 'error').length} 个错误）：${v.issues.find(i => i.severity === 'error')?.message ?? ''}`,
      v,
    )
}

/** B6：整份写回持久草图或设计的草图；返回写进的文件与新指纹 */
export function saveSketch(modelRoot: string, project: string, req: SaveSketchRequest, root: string): { file: string; hash: string } {
  const dir = projectDir(modelRoot, project)
  const rel = targetFile(req?.target)
  const file = path.join(dir, rel)
  if (!fs.existsSync(file)) throw new WriteError(`草图不存在：${rel}`)
  if (!req.sketch || typeof req.sketch !== 'object') throw new WriteError('缺少草图')
  if (sketchHash(fs.readFileSync(file, 'utf8')) !== req.baseHash) throw new WriteConflict('文件已变，重新加载后再改（X7i）')
  check(req.sketch, persistentSketches(dir, root), rel)
  const doc = openDoc(file, '')
  if (!isMap(doc.get('sketch'))) throw new WriteError(`${rel} 缺少顶层键 sketch`)
  doc.set('sketch', merge(doc, doc.get('sketch', true) as Node, req.sketch))
  const out = save(file, doc, root, modelRoot, project)
  appendLedger(governanceDir(modelRoot, project), {
    at: new Date().toISOString(),
    tool: 'sketch',
    origin: 'page',
    file: rel,
    ...(req.target.kind === 'design' ? { design: req.target.design } : {}),
  })
  return { file: out.file, hash: sketchHash(fs.readFileSync(file, 'utf8')) }
}

/** S-4：新建设计——design.yaml（status: draft、base 取当前版本）与草图（底稿由页面经 seedSketch 给出），两者登记指纹 */
export function createDesign(
  modelRoot: string,
  project: string,
  req: { id: string; name: string; goal?: string; sketch: SketchDef },
  root: string,
): { file: string; files: string[] } {
  const dir = projectDir(modelRoot, project)
  const id = req?.id?.trim()
  if (!id || !isProjectId(id)) throw new WriteError('设计 ID 只能包含字母、数字和 . _ -，且以字母或数字开头')
  if (!req.name?.trim()) throw new WriteError('设计名称不能为空')
  const designDir = path.join(dir, DESIGNS_DIR, id)
  if (fs.existsSync(designDir)) throw new WriteConflict(`设计已存在：${id}`)
  const sketch: SketchDef = { ...(req.sketch ?? { modules: [] }), id }
  check(sketch, persistentSketches(dir, root), `${DESIGNS_DIR}/${id}/${SKETCH_FILE}`)
  const system = load(readModelDir(dir, root).files.filter(f => f.path === 'system.yaml')).model.system
  const design = {
    design: {
      id,
      name: req.name.trim(),
      status: 'draft',
      ...(req.goal?.trim() ? { goal: req.goal.trim() } : {}),
      base: { ...(system.source?.commit ? { commit: system.source.commit } : {}), generatedAt: system.source?.generatedAt ?? today() },
    },
  }
  fs.mkdirSync(designDir, { recursive: true })
  const files = [
    {
      rel: `${DESIGNS_DIR}/${id}/design.yaml`,
      text: `# 设计「${req.name.trim()}」（人拥有）：目标、状态、基线与各轮的评审意见；每轮说明在 r<N>/revision.yaml（E8）\n${stringify(design, { lineWidth: 0 })}`,
    },
    { rel: `${DESIGNS_DIR}/${id}/${SKETCH_FILE}`, text: `# 草图（人拥有）：架构师的意图，AI 按它展开各轮（ADR-0023）\n${sketchText(sketch)}` },
  ]
  for (const f of files) {
    fs.writeFileSync(path.join(dir, f.rel), f.text)
    touchOwned(modelRoot, project, f.rel)
  }
  appendLedger(governanceDir(modelRoot, project), {
    at: new Date().toISOString(),
    tool: 'sketch',
    origin: 'page',
    file: files[1].rel,
    design: id,
    created: true,
  })
  const rels = files.map(f => path.relative(root, path.join(dir, f.rel)).split(path.sep).join('/'))
  return { file: rels[1], files: rels }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * 把新值合并进已有节点：没变的节点原样返回（连同注释）；映射逐键、带 id 的对象列表按 id 对齐、标量变了才改值；
 * 新建的对象跟随同一列表里已有条目的写法（流式 { … } 或块式）。
 */
function merge(doc: Document, node: Node | undefined, value: unknown): Node {
  if (node && same(node.toJSON(), value)) return node
  if (isScalar(node) && (value === null || typeof value !== 'object')) {
    node.value = value
    return node
  }
  if (isMap(node) && plain(value)) {
    for (const item of [...node.items]) {
      const key = isScalar(item.key) ? String(item.key.value) : String(item.key)
      if (!(key in value)) node.delete(key)
    }
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue
      node.set(k, merge(doc, node.get(k, true) as Node | undefined, v))
    }
    return node
  }
  if (isSeq(node) && Array.isArray(value)) {
    const byId = value.every(v => plain(v) && typeof v.id === 'string')
    const old = node.items as Node[]
    const flow = old.length > 0 && old.every(i => isMap(i) && i.flow)
    node.items = value.map((v, i) => {
      const hit = byId ? old.find(o => isMap(o) && o.get('id') === (v as { id: string }).id) : old[i]
      if (hit) return merge(doc, hit, v)
      const fresh = doc.createNode(v) as Node
      if (flow && isMap(fresh)) fresh.flow = true
      return fresh
    })
    return node
  }
  return doc.createNode(value) as Node
}
