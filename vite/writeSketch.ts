/**
 * 草图写回（B6、B7、X7i、X20，ADR-0024、ADR-0025）：人拥有的草图整份写回与新建设计，写回只经这一处。
 * 按设计写回（saveDesignSketches）：一次请求带该设计改过的全部草图与各自读取时的指纹 → 全部比对（任一不符整次拒绝，409）→
 * 逐张跑 validateSketch（有格式错误拒绝，422；语义提示不拦）→ 丢掉没有关系的引用节点（X19）→ 用 YAML 文档模型合并
 * （映射逐键、带 id 的列表按 id 对齐、标量值变了才替换；注释只在未改动的节点上保留）→ 写回：新文件写出、级联改名（X12）的写到新文件名并删旧文件、
 * 删掉的子草图删文件（B7，只限 designs/<设计>/sketches/*，永不动 intent/*）→ 更新指纹（X6）→ 每个文件一行拦截记录。
 * 持久草图（intent/<ID>.yaml）与单张设计草图仍可用 saveSketch 整份写回。文档的打开与保存与追加写入共用（writeModel.ts 的 openDoc / save）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { isMap, isScalar, isSeq, stringify, type Document, type Node } from 'yaml'
import {
  designSketchPath,
  dropOrphanReferences,
  isSketchFile,
  load,
  loadModel,
  sketchLifetime,
  sketchText,
  validateSketch,
  type SketchDef,
  type SketchEntity,
  type SketchTarget,
  type SketchValidation,
  type ValidateContext,
} from '../src/model'
import { DESIGNS_DIR, SKETCHES_DIR, isProjectId, readModelDir, sketchHash } from './readModelDir'
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

/** X20：按设计写回的一张草图 */
export interface DesignSketchWrite {
  /** 写到哪个挂载点（文件名 sketches/<mount>.yaml，X9）；须与 sketch.mount 一致 */
  mount: string
  sketch: SketchDef
  /** 读取时的指纹；null 为新文件（会话里推出并改过的） */
  baseHash: string | null
  /** X12：级联改名前的挂载点（读取时的文件为 sketches/<renamedFrom>.yaml，写回后删掉） */
  renamedFrom?: string
}

export interface SaveDesignRequest {
  sketches: DesignSketchWrite[]
  /** B7：删掉的草图（删带下一层草图的模块时由人确认后一并删）与读取时的指纹 */
  removed?: { mount: string; baseHash: string }[]
}

export interface SaveDesignResult {
  /** 写进的文件（相对项目根）与新指纹 */
  files: { mount: string; file: string; hash: string }[]
  /** 删掉的文件（相对项目根） */
  removed: string[]
  /** X19：保存时丢掉的、没有关系的引用节点 */
  dropped: { mount: string; ids: string[] }[]
}

/** 目标草图文件（相对项目描述目录）：设计的草图按挂载点（X9） */
function targetFile(target: SketchTarget, sketch: SketchDef | undefined): string {
  if (target?.kind === 'design' && isProjectId(target.design) && sketch?.mount && isProjectId(sketch.mount))
    return designSketchPath(target.design, sketch.mount)
  if (target?.kind === 'persistent' && isProjectId(target.id)) return `intent/${target.id}.yaml`
  throw new WriteError('草图目标不合法')
}

/** 磁盘上的持久草图与当前版本（校验的上下文） */
function context(dir: string, root: string): { persistent: SketchEntity[]; index: ValidateContext['index'] } {
  const files = readModelDir(dir, root).files
  const persistent = load(files.filter(f => isSketchFile(f.path))).model.sketches.filter(s => sketchLifetime(s) === 'persistent')
  return { persistent, index: loadModel(files).index }
}

function check(sketch: SketchDef, ctx: ValidateContext): void {
  const v = validateSketch(sketch, ctx)
  if (!v.ok) throw new SketchInvalid(`草图「${sketch.mount}」校验不过（${v.errors.length} 个错误）：${v.errors[0]?.message ?? ''}`, v)
}

/** B6：整份写回持久草图或设计的一张草图（按它的挂载点）；返回写进的文件与新指纹 */
export function saveSketch(modelRoot: string, project: string, req: SaveSketchRequest, root: string): { file: string; hash: string } {
  if (!req?.sketch || typeof req.sketch !== 'object') throw new WriteError('缺少草图')
  if (req.target?.kind === 'design') {
    const out = saveDesignSketches(
      modelRoot,
      project,
      req.target.design,
      { sketches: [{ mount: req.sketch.mount, sketch: req.sketch, baseHash: req.baseHash }] },
      root,
    )
    return { file: out.files[0].file, hash: out.files[0].hash }
  }
  const dir = projectDir(modelRoot, project)
  const rel = targetFile(req.target, req.sketch)
  const file = path.join(dir, rel)
  if (!fs.existsSync(file)) throw new WriteError(`草图不存在：${rel}`)
  if (sketchHash(fs.readFileSync(file, 'utf8')) !== req.baseHash) throw new WriteConflict('文件已变，重新加载后再改（X7i）')
  const ctx = context(dir, root)
  check(req.sketch, { ...ctx, file: rel })
  const { sketch } = dropOrphanReferences(req.sketch)
  const doc = openDoc(file, '')
  if (!isMap(doc.get('sketch'))) throw new WriteError(`${rel} 缺少顶层键 sketch`)
  doc.set('sketch', merge(doc, doc.get('sketch', true) as Node, sketch))
  const out = save(file, doc, root, modelRoot, project)
  appendLedger(governanceDir(modelRoot, project), { at: new Date().toISOString(), tool: 'sketch', origin: 'page', file: rel })
  return { file: out.file, hash: sketchHash(fs.readFileSync(file, 'utf8')) }
}

/** X20、B6、B7：按设计写回——先全部比对指纹、全部校验，都过了才写任何文件 */
export function saveDesignSketches(modelRoot: string, project: string, design: string, req: SaveDesignRequest, root: string): SaveDesignResult {
  const dir = projectDir(modelRoot, project)
  if (!isProjectId(design) || !fs.existsSync(path.join(dir, DESIGNS_DIR, design, 'design.yaml'))) throw new WriteError(`设计不存在：${design}`)
  const writes = Array.isArray(req?.sketches) ? req.sketches : []
  const removed = Array.isArray(req?.removed) ? req.removed : []
  if (!writes.length && !removed.length) throw new WriteError('没有要写的草图')
  const abs = (rel: string) => path.join(dir, rel)
  const rel = (mount: string) => {
    if (!isProjectId(mount)) throw new WriteError(`挂载点不合法：${mount}`)
    return designSketchPath(design, mount)
  }
  // ① 指纹：任一不符整次拒绝（X7i）
  const plan = writes.map(w => {
    if (!w?.sketch || typeof w.sketch !== 'object') throw new WriteError('缺少草图')
    if (w.sketch.mount !== w.mount) throw new WriteError(`草图的 mount「${w.sketch.mount}」与写入位置「${w.mount}」不一致（X9）`)
    const to = rel(w.mount)
    const from = w.renamedFrom ? rel(w.renamedFrom) : to
    if (w.baseHash === null) {
      if (fs.existsSync(abs(to))) throw new WriteConflict(`草图已存在：${to}，重新加载后再改（X7i）`)
    } else {
      if (!fs.existsSync(abs(from))) throw new WriteConflict(`草图已不存在：${from}，重新加载后再改（X7i）`)
      if (sketchHash(fs.readFileSync(abs(from), 'utf8')) !== w.baseHash) throw new WriteConflict(`文件已变：${from}，重新加载后再改（X7i）`)
      if (from !== to && fs.existsSync(abs(to))) throw new WriteConflict(`改名的目标已存在：${to}`)
    }
    return { w, from, to }
  })
  const gone = removed.map(r => {
    const f = rel(r.mount)
    if (!fs.existsSync(abs(f))) throw new WriteConflict(`要删的草图已不存在：${f}`)
    if (sketchHash(fs.readFileSync(abs(f), 'utf8')) !== r.baseHash) throw new WriteConflict(`文件已变：${f}，重新加载后再改（X7i）`)
    return f
  })
  // ② 校验：以持久草图、当前版本与本设计保存后的其他草图为上下文（X14：只拦格式错误）
  const ctx = context(dir, root)
  const after: Record<string, SketchDef> = {}
  const keep = fs.existsSync(abs(`${DESIGNS_DIR}/${design}/${SKETCHES_DIR}`)) ? fs.readdirSync(abs(`${DESIGNS_DIR}/${design}/${SKETCHES_DIR}`)) : []
  for (const f of keep) {
    const r = `${DESIGNS_DIR}/${design}/${SKETCHES_DIR}/${f}`
    if (gone.includes(r) || plan.some(p => p.from === r)) continue
    const s = load([{ path: r, text: fs.readFileSync(abs(r), 'utf8') }]).model.sketches[0]
    if (s) after[s.def.mount] = s.def
  }
  for (const p of plan) after[p.w.mount] = p.w.sketch
  for (const p of plan) check(p.w.sketch, { ...ctx, file: p.to, design: after })
  // ③ 写：合并进已有文档（保留未改动节点的注释），改名的写到新文件名后删旧文件
  const at = new Date().toISOString()
  const ledger = governanceDir(modelRoot, project)
  const files: SaveDesignResult['files'] = []
  const dropped: SaveDesignResult['dropped'] = []
  for (const { w, from, to } of plan) {
    const clean = dropOrphanReferences(w.sketch)
    if (clean.dropped.length) dropped.push({ mount: w.mount, ids: clean.dropped })
    fs.mkdirSync(path.dirname(abs(to)), { recursive: true })
    if (w.baseHash === null) {
      fs.writeFileSync(
        abs(to),
        `# 草图（人拥有）：挂在「${w.mount}」下的一层（ADR-0025）
${sketchText(clean.sketch)}`,
      )
      touchOwned(modelRoot, project, to)
    } else {
      const doc = openDoc(abs(from), '')
      if (!isMap(doc.get('sketch'))) throw new WriteError(`${from} 缺少顶层键 sketch`)
      doc.set('sketch', merge(doc, doc.get('sketch', true) as Node, clean.sketch))
      save(abs(to), doc, root, modelRoot, project)
      if (from !== to) {
        fs.unlinkSync(abs(from))
        touchOwned(modelRoot, project, from)
      }
    }
    appendLedger(ledger, {
      at,
      tool: 'sketch',
      origin: 'page',
      file: to,
      design,
      ...(w.baseHash === null ? { created: true } : {}),
      ...(from !== to ? { renamedFrom: from } : {}),
    })
    files.push({ mount: w.mount, file: path.relative(root, abs(to)).split(path.sep).join('/'), hash: sketchHash(fs.readFileSync(abs(to), 'utf8')) })
  }
  for (const f of gone) {
    fs.unlinkSync(abs(f))
    touchOwned(modelRoot, project, f)
    appendLedger(ledger, { at, tool: 'sketch', origin: 'page', file: f, design, removed: true })
  }
  return { files, removed: gone.map(f => path.relative(root, abs(f)).split(path.sep).join('/')), dropped }
}

/** S-4、X18：新建设计——design.yaml（status: draft、base 取当前版本）与草图（底稿由调用方经 seedFromBaseline 给出，可多张），全部登记指纹 */
export function createDesign(
  modelRoot: string,
  project: string,
  req: { id: string; name: string; goal?: string; sketch?: SketchDef; sketches?: SketchDef[] },
  root: string,
): { file: string; files: string[] } {
  const dir = projectDir(modelRoot, project)
  const id = req?.id?.trim()
  if (!id || !isProjectId(id)) throw new WriteError('设计 ID 只能包含字母、数字和 . _ -，且以字母或数字开头')
  if (!req.name?.trim()) throw new WriteError('设计名称不能为空')
  const designDir = path.join(dir, DESIGNS_DIR, id)
  if (fs.existsSync(designDir)) throw new WriteConflict(`设计已存在：${id}`)
  const given = req.sketches?.length ? req.sketches : req.sketch ? [req.sketch] : []
  if (!given.length) throw new WriteError('新建设计至少要有一张草图（挂载点与底稿）')
  const sketches = given.map(s => ({ ...s, id }))
  const mounts = sketches.map(s => s.mount)
  if (mounts.some(m => !m || !isProjectId(m)) || new Set(mounts).size !== mounts.length) throw new WriteError('草图的挂载点缺失、不合法或重复（X9）')
  const ctx = context(dir, root)
  const set = Object.fromEntries(sketches.map(s => [s.mount, s]))
  for (const s of sketches) check(s, { ...ctx, file: designSketchPath(id, s.mount), design: set })
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
  fs.mkdirSync(path.join(designDir, SKETCHES_DIR), { recursive: true })
  const files = [
    {
      rel: `${DESIGNS_DIR}/${id}/design.yaml`,
      text: `# 设计「${req.name.trim()}」（人拥有）：目标、状态、基线与各轮的评审意见；每轮说明在 r<N>/revision.yaml（E8）\n${stringify(design, { lineWidth: 0 })}`,
    },
    ...sketches.map(s => ({
      rel: designSketchPath(id, s.mount),
      text: `# 草图（人拥有）：挂在「${s.mount}」下的一层，架构师的意图，AI 按它展开各轮（ADR-0023、ADR-0025）\n${sketchText(dropOrphanReferences(s).sketch)}`,
    })),
  ]
  for (const f of files) {
    fs.writeFileSync(path.join(dir, f.rel), f.text)
    touchOwned(modelRoot, project, f.rel)
  }
  for (const f of files.slice(1))
    appendLedger(governanceDir(modelRoot, project), { at: new Date().toISOString(), tool: 'sketch', origin: 'page', file: f.rel, design: id, created: true })
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
