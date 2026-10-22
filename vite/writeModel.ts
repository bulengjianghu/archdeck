/**
 * 描述写入（B1–B6，ADR-0019、ADR-0023）：页面只能追加人拥有的内容——设计某一轮的评审意见（design.yaml feedback）、认可的偏差（design.yaml accepted，X4）、
 * 架构规则的例外（rules.yaml 的 rules.allow）、源码忽略项（source-ignore.yaml 的 sourceIgnore）、确认记录（reviewed.yaml 的 reviewed，Z1、Z6，
 * 同一模块再次确认时更新那一条）；归档 / 晋升改设计状态、晋升时整份替换持久草图（X3）。
 * AI 生成的部分（modules/、scenarios/、system.yaml 等）不写。只追加、不删改；用 YAML 文档模型修改，保留注释与其他内容；写后更新指纹（X6）。
 * 写后由开发服务器的文件监听推送 arch-model:changed，页面按 N5 重新加载。
 *
 * 约定（草图归档调用，Z6）：`appendReviewed(modelRoot, project, entries)` 一次写多条，entries 的每条为
 * `{ module, at, hash, summary, source, note? }`（ReviewedInput，由模型层 `reviewEntries(index, ids, { source: 'sketch:<设计 ID>' })` 构造）；
 * 同一模块已有记录时更新那一条，否则追加；返回写进的文件与更新 / 追加的模块 ID。
 * 每条的 hash 必须等于用当前描述算出的 reviewHash，不符即拒绝整次写入；每次写入在 governance/ledger.jsonl 追加一行（Z6）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { isMap, isSeq, parseDocument, type Document } from 'yaml'
import {
  RULE_KINDS,
  archiveVerdict,
  checkSketches,
  isReviewSource,
  loadModel,
  parseDesignSketches,
  reviewEntries,
  reviewHash,
  sketchModules,
  type ArchiveVerdict,
  type ModelIndex,
  type ReviewedInput,
  type ReviewedOrigin,
  type RuleKind,
} from '../src/model'
import { DESIGNS_DIR, SKETCH_FILE, designSketch, isProjectId, listRevisionDirs, readDesignInfo, readModelDir } from './readModelDir'
import { appendLedger, governanceDir, touchOwned } from './governanceStore'

export class WriteError extends Error {}

export type WriteResult = { file: string }

export const today = () => new Date().toISOString().slice(0, 10)

/** 打开 YAML 文档（解析失败拒绝写）；草图写回共用（access.writer.sketch） */
export function openDoc(file: string, empty: string): Document {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : empty
  const doc = parseDocument(text)
  if (doc.errors.length) throw new WriteError(`${path.basename(file)} 解析失败：${doc.errors[0].message.split('\n')[0]}，请先修好再写`)
  return doc
}

/** 写回并更新指纹（X6）：file 为绝对路径，modelRoot / project 给出它相对项目描述目录的位置 */
export function save(file: string, doc: Document, root: string, modelRoot: string, project: string): WriteResult {
  fs.writeFileSync(file, doc.toString({ lineWidth: 0 }))
  touchOwned(modelRoot, project, path.relative(path.join(modelRoot, project), file).split(path.sep).join('/'))
  return { file: path.relative(root, file).split(path.sep).join('/') }
}

export function projectDir(modelRoot: string, project: string): string {
  const dir = path.join(modelRoot, project)
  if (!isProjectId(project) || !fs.existsSync(path.join(dir, 'system.yaml'))) throw new WriteError(`项目不存在：${project}`)
  return dir
}

/** B2：在设计某一轮的 feedback 后追加一段评审意见（前加日期）；revisions[] 里还没有该轮的条目时新建 { id, feedback }（轮次从目录发现，E8） */
export function appendFeedback(modelRoot: string, project: string, design: string, revision: string, text: string, root: string): WriteResult {
  const body = text.trim()
  if (!body) throw new WriteError('评审意见不能为空')
  if (!isProjectId(design) || !isProjectId(revision)) throw new WriteError('设计或轮次 ID 不合法')
  const file = path.join(projectDir(modelRoot, project), DESIGNS_DIR, design, 'design.yaml')
  if (!fs.existsSync(file)) throw new WriteError(`设计不存在：${design}`)
  const doc = openDoc(file, '')
  if (!isMap(doc.get('design'))) throw new WriteError('design.yaml 缺少顶层键 design')
  let revs = doc.getIn(['design', 'revisions'])
  if (revs !== undefined && !isSeq(revs)) throw new WriteError('design.revisions 不是列表')
  let rev = isSeq(revs) ? revs.items.find(r => isMap(r) && r.get('id') === revision) : undefined
  if (!rev) {
    if (!listRevisionDirs(path.dirname(file)).includes(revision)) throw new WriteError(`轮次不存在：${design} / ${revision}`)
    if (!isSeq(revs)) {
      doc.setIn(['design', 'revisions'], doc.createNode([]))
      revs = doc.getIn(['design', 'revisions'])
    }
    rev = doc.createNode({ id: revision })
    ;(revs as { items: unknown[] }).items.push(rev)
  }
  if (!isMap(rev)) throw new WriteError(`轮次不存在：${design} / ${revision}`)
  const before = rev.get('feedback')
  const entry = `（${today()} 页面记录）${body}`
  rev.set('feedback', typeof before === 'string' && before.trim() ? `${before.trimEnd()}\n\n${entry}\n` : `${entry}\n`)
  return save(file, doc, root, modelRoot, project)
}

export interface AllowInput {
  from: string
  to: string
  rule?: RuleKind
  reason: string
}

/** B3：在 rules.allow 追加一条例外；两端必须是存在的模块，理由必填，同一条已有时拒绝 */
export function appendAllow(modelRoot: string, project: string, input: AllowInput, root: string): WriteResult {
  const dir = projectDir(modelRoot, project)
  const reason = input.reason?.trim()
  if (!reason) throw new WriteError('例外必须写理由（U5）')
  if (input.rule !== undefined && !RULE_KINDS.includes(input.rule)) throw new WriteError(`rule 只能是 ${RULE_KINDS.join(' / ')}`)
  const { index } = loadModel(readModelDir(dir, root).files)
  for (const id of [input.from, input.to]) if (!index.modules.has(id)) throw new WriteError(`模块不存在：${id}`)
  const file = path.join(dir, index.model.rulesSrc?.file ?? 'rules.yaml')
  const doc = openDoc(file, 'rules: {}\n')
  if (!doc.has('rules') || !isMap(doc.get('rules'))) doc.set('rules', doc.createNode({}))
  const allow = doc.getIn(['rules', 'allow'])
  if (allow !== undefined && !isSeq(allow)) throw new WriteError('rules.allow 不是列表')
  const same = (a: unknown) => isMap(a) && a.get('from') === input.from && a.get('to') === input.to && (a.get('rule') ?? undefined) === input.rule
  if (isSeq(allow) && allow.items.some(same)) throw new WriteError('这条例外已经存在')
  const node = doc.createNode({ from: input.from, to: input.to, ...(input.rule ? { rule: input.rule } : {}), reason: `${reason}（${today()} 页面记录）` })
  node.flow = true
  if (isSeq(allow)) allow.items.push(node)
  else doc.setIn(['rules', 'allow'], doc.createNode([node]))
  return save(file, doc, root, modelRoot, project)
}

/** B4：在 source-ignore.yaml 的 sourceIgnore 追加一个 glob；没有文件时新建；已存在的拒绝 */
export function appendIgnore(modelRoot: string, project: string, pattern: string, root: string): WriteResult {
  const dir = projectDir(modelRoot, project)
  const p = pattern?.trim()
  if (!p || /[\n\r]/.test(p) || p.startsWith('/') || p.split('/').includes('..')) throw new WriteError('忽略项必须是相对源码根目录的 glob，不含 ..')
  const file = path.join(dir, 'source-ignore.yaml')
  const doc = openDoc(file, 'sourceIgnore: []\n')
  const list = doc.get('sourceIgnore')
  if (list !== undefined && !isSeq(list)) throw new WriteError('sourceIgnore 不是列表')
  if (isSeq(list) && list.items.some(i => (i as { value?: unknown }).value === p)) throw new WriteError(`已在忽略清单中：${p}`)
  if (isSeq(list)) {
    list.flow = false
    list.items.push(doc.createNode(p))
  } else doc.set('sourceIgnore', doc.createNode([p]))
  return save(file, doc, root, modelRoot, project)
}

/** X4：在设计的 accepted 追加一条认可的偏差；理由必填；同一键已有时拒绝 */
export function appendAccepted(modelRoot: string, project: string, design: string, deviation: string, reason: string, root: string): WriteResult {
  const key = deviation?.trim()
  const why = reason?.trim()
  if (!key || /[\n\r]/.test(key)) throw new WriteError('偏差的键不合法')
  if (!why) throw new WriteError('认可偏差必须写理由（X4）')
  if (!isProjectId(design)) throw new WriteError('设计 ID 不合法')
  const file = path.join(projectDir(modelRoot, project), DESIGNS_DIR, design, 'design.yaml')
  if (!fs.existsSync(file)) throw new WriteError(`设计不存在：${design}`)
  const doc = openDoc(file, '')
  if (!isMap(doc.get('design'))) throw new WriteError('design.yaml 缺少顶层键 design')
  const list = doc.getIn(['design', 'accepted'])
  if (list !== undefined && !isSeq(list)) throw new WriteError('design.accepted 不是列表')
  if (isSeq(list) && list.items.some(a => isMap(a) && a.get('deviation') === key)) throw new WriteError('这条偏差已经认可过')
  const node = doc.createNode({ deviation: key, reason: why, at: today() })
  node.flow = true
  if (isSeq(list)) list.items.push(node)
  else doc.setIn(['design', 'accepted'], doc.createNode([node]))
  return save(file, doc, root, modelRoot, project)
}

export interface ArchiveResult extends WriteResult {
  outcome: ArchiveVerdict['outcome']
  /** 归档：写入的确认记录条数（更新 + 追加）与文件；草图没有覆盖现有模块时为 0、不写文件 */
  reviewed?: { count: number; file: string }
  /** 晋升：被替换的持久草图文件 */
  promoted?: string
}

/**
 * X3：归档 / 晋升。先对当前版本核验（含认可的偏差），不一致即拒绝；
 * until-implemented → design.yaml 的 status 改为 implemented，并经确认层写入草图覆盖的模块的确认记录（reviewEntries 按确认层的口径算指纹与摘要，appendReviewed 逐条更新或追加，来源 sketch:<设计 ID>，Z6）；
 * 确认记录先写、设计状态后改：记录校验不过时整次归档不生效。
 * supersedes → 草图整份替换 intent/<ID>.yaml（id 改为被替换者、lifetime persistent、去掉 supersedes），状态同样改为 implemented。
 */
export function archiveDesign(modelRoot: string, project: string, design: string, root: string): ArchiveResult {
  const dir = projectDir(modelRoot, project)
  if (!isProjectId(design)) throw new WriteError('设计 ID 不合法')
  const designDir = path.join(dir, DESIGNS_DIR, design)
  const file = path.join(designDir, 'design.yaml')
  if (!fs.existsSync(file)) throw new WriteError(`设计不存在：${design}`)
  const info = readDesignInfo(designDir, design)
  const sketch = designSketch(dir, design)
  if (!sketch) throw new WriteError(`设计「${design}」没有草图（${DESIGNS_DIR}/${design}/${SKETCH_FILE}），没有可归档的意图`)
  if (info.status === 'implemented' || info.status === 'abandoned') throw new WriteError(`设计「${design}」已归档（${info.status}）`)
  const { index } = loadModel(readModelDir(dir, root).files)
  const entity = parseDesignSketches([sketch])[0]
  if (!entity) throw new WriteError('草图解析失败，先运行 npm run lint:model')
  const check = checkSketches(index, [entity], new Map([[design, info.accepted ?? []]])).find(c => c.design === design)!
  const verdict = archiveVerdict(check)
  if (!verdict.ok) throw new WriteError(`不能归档：${verdict.reason}`)
  const at = today()
  const doc = openDoc(file, '')
  if (!isMap(doc.get('design'))) throw new WriteError('design.yaml 缺少顶层键 design')
  let promoted: string | undefined
  let reviewed: ArchiveResult['reviewed']
  if (verdict.outcome === 'promote') {
    // 晋升：草图整份替换对应的持久草图（B6）
    const target = entity.def.supersedes!
    if (!isProjectId(target)) throw new WriteError(`supersedes 不合法：${target}`)
    const sdoc = openDoc(path.join(designDir, SKETCH_FILE), '')
    sdoc.setIn(['sketch', 'id'], target)
    sdoc.setIn(['sketch', 'lifetime'], 'persistent')
    sdoc.deleteIn(['sketch', 'supersedes'])
    const dest = path.join(dir, 'intent', `${target}.yaml`)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    promoted = save(dest, sdoc, root, modelRoot, project).file
  } else {
    const modules = sketchModules(entity, index)
    if (modules.length) {
      const r = appendReviewed(modelRoot, project, reviewEntries(index, modules, { source: `sketch:${design}`, at }), root, { origin: 'archive', design })
      reviewed = { count: r.added.length + r.updated.length, file: r.file }
    } else reviewed = { count: 0, file: path.relative(root, path.join(dir, 'reviewed.yaml')).split(path.sep).join('/') }
  }
  doc.setIn(['design', 'status'], 'implemented')
  const out = save(file, doc, root, modelRoot, project)
  return { ...out, outcome: verdict.outcome, ...(reviewed ? { reviewed } : {}), ...(promoted ? { promoted } : {}) }
}

export interface ReviewedWriteResult extends WriteResult {
  /** 更新了已有记录的模块 */
  updated: string[]
  /** 新追加记录的模块 */
  added: string[]
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** 一条记录的校验与规整；坏的抛 WriteError */
function cleanEntry(raw: unknown, index: ModelIndex): ReviewedInput {
  const e = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReviewedInput>
  if (typeof e.module !== 'string' || !index.modules.has(e.module)) throw new WriteError(`模块不存在：${String(e.module)}`)
  if (typeof e.hash !== 'string' || !e.hash.trim()) throw new WriteError(`模块「${e.module}」的记录缺少 hash`)
  if (e.hash.trim() !== reviewHash(index, e.module))
    throw new WriteError(`模块「${e.module}」的记录 hash 与当前描述的指纹不符：描述已变，请刷新后重新确认（Z6）`)
  if (!isReviewSource(e.source)) throw new WriteError(`模块「${e.module}」的记录 source 只能是 manual 或 sketch:<设计 ID>`)
  const at = e.at === undefined ? today() : e.at
  if (typeof at !== 'string' || !DATE.test(at)) throw new WriteError(`模块「${e.module}」的记录 at 必须是 YYYY-MM-DD`)
  if (e.summary !== undefined && (typeof e.summary !== 'object' || e.summary === null || Array.isArray(e.summary)))
    throw new WriteError(`模块「${e.module}」的记录 summary 必须是对象`)
  const note = typeof e.note === 'string' ? e.note.trim() : ''
  return { module: e.module, at, hash: e.hash.trim(), source: e.source, ...(note ? { note } : {}), summary: e.summary ?? {} }
}

/**
 * Z1、Z6：在 reviewed.yaml 的 reviewed 里按模块更新或追加一条或多条记录；没有文件时新建。
 * 同一批里同一模块出现多次时取最后一条。全部记录校验通过（含 hash 等于当前 reviewHash）才写，否则一条都不写；
 * 写后在拦截记录追加一行（来源 page / cli / archive、模块数、设计 ID）。
 */
export function appendReviewed(
  modelRoot: string,
  project: string,
  entries: readonly unknown[],
  root: string = path.dirname(modelRoot),
  opts: { origin?: ReviewedOrigin; design?: string } = {},
): ReviewedWriteResult {
  const dir = projectDir(modelRoot, project)
  if (!Array.isArray(entries) || !entries.length) throw new WriteError('没有要写的确认记录')
  const { index } = loadModel(readModelDir(dir, root).files)
  const byModule = new Map<string, ReviewedInput>()
  for (const raw of entries) {
    const e = cleanEntry(raw, index)
    byModule.set(e.module, e)
  }
  const file = path.join(dir, 'reviewed.yaml')
  const doc = openDoc(file, '# 确认记录（Z1，ADR-0023）：架构师确认过的模块，由页面与草图归档写入；AI 重新生成描述时不改动\nreviewed: []\n')
  if (!doc.has('reviewed')) doc.set('reviewed', doc.createNode([]))
  const list = doc.get('reviewed')
  if (!isSeq(list)) throw new WriteError('reviewed 不是列表')
  list.flow = false
  const updated: string[] = []
  const added: string[] = []
  for (const e of byModule.values()) {
    const node = doc.createNode({ module: e.module, at: e.at, hash: e.hash, source: e.source, ...(e.note ? { note: e.note } : {}), summary: e.summary })
    node.flow = false
    const at = list.items.findIndex(i => isMap(i) && i.get('module') === e.module)
    if (at >= 0) {
      list.items[at] = node
      updated.push(e.module)
    } else {
      list.items.push(node)
      added.push(e.module)
    }
  }
  const out = save(file, doc, root, modelRoot, project)
  appendLedger(governanceDir(modelRoot, project), {
    at: new Date().toISOString(),
    tool: 'reviewed',
    origin: opts.origin ?? 'cli',
    modules: byModule.size,
    ...(opts.design ? { design: opts.design } : {}),
  })
  return { ...out, updated, added }
}
