/**
 * 描述写入（B1–B6，ADR-0019、ADR-0023）：页面只能追加人拥有的内容——设计某一轮的评审意见（design.yaml feedback）、认可的偏差（design.yaml accepted，X4）、
 * 架构规则的例外（rules.yaml 的 rules.allow）、源码忽略项（source-ignore.yaml 的 sourceIgnore）；归档 / 晋升改设计状态、晋升时整份替换持久草图（X3）。
 * AI 生成的部分（modules/、scenarios/、system.yaml 等）不写。只追加、不删改；用 YAML 文档模型修改，保留注释与其他内容；写后更新指纹（X6）。
 * 写后由开发服务器的文件监听推送 arch-model:changed，页面按 N5 重新加载。
 */
import fs from 'node:fs'
import path from 'node:path'
import { isMap, isSeq, parseDocument, type Document } from 'yaml'
import { RULE_KINDS, archiveVerdict, checkSketches, loadModel, parseDesignSketches, reviewedEntries, type ArchiveVerdict, type RuleKind } from '../src/model'
import { DESIGNS_DIR, SKETCH_FILE, designSketch, isProjectId, readDesignInfo, readModelDir } from './readModelDir'
import { touchOwned } from './governanceStore'
import { appendReviewed } from './reviewedHook'

export class WriteError extends Error {}

export type WriteResult = { file: string }

const today = () => new Date().toISOString().slice(0, 10)

function openDoc(file: string, empty: string): Document {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : empty
  const doc = parseDocument(text)
  if (doc.errors.length) throw new WriteError(`${path.basename(file)} 解析失败：${doc.errors[0].message.split('\n')[0]}，请先修好再写`)
  return doc
}

/** 写回并更新指纹（X6）：file 为绝对路径，modelRoot / project 给出它相对项目描述目录的位置 */
function save(file: string, doc: Document, root: string, modelRoot: string, project: string): WriteResult {
  fs.writeFileSync(file, doc.toString({ lineWidth: 0 }))
  touchOwned(modelRoot, project, path.relative(path.join(modelRoot, project), file).split(path.sep).join('/'))
  return { file: path.relative(root, file).split(path.sep).join('/') }
}

function projectDir(modelRoot: string, project: string): string {
  const dir = path.join(modelRoot, project)
  if (!isProjectId(project) || !fs.existsSync(path.join(dir, 'system.yaml'))) throw new WriteError(`项目不存在：${project}`)
  return dir
}

/** B2：在设计某一轮的 feedback 后追加一段评审意见（前加日期） */
export function appendFeedback(modelRoot: string, project: string, design: string, revision: string, text: string, root: string): WriteResult {
  const body = text.trim()
  if (!body) throw new WriteError('评审意见不能为空')
  if (!isProjectId(design) || !isProjectId(revision)) throw new WriteError('设计或轮次 ID 不合法')
  const file = path.join(projectDir(modelRoot, project), DESIGNS_DIR, design, 'design.yaml')
  if (!fs.existsSync(file)) throw new WriteError(`设计不存在：${design}`)
  const doc = openDoc(file, '')
  const revs = doc.getIn(['design', 'revisions'])
  const rev = isSeq(revs) ? revs.items.find(r => isMap(r) && r.get('id') === revision) : undefined
  if (!rev || !isMap(rev)) throw new WriteError(`轮次不存在：${design} / ${revision}`)
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
  /** 归档：写入的确认记录条数；桩时 pending */
  reviewed?: { count: number; file: string; pending?: true }
  /** 晋升：被替换的持久草图文件 */
  promoted?: string
}

/**
 * X3：归档 / 晋升。先对当前版本核验（含认可的偏差），不一致即拒绝；
 * until-implemented → design.yaml 的 status 改为 implemented，并经确认层的 appendReviewed 写入草图覆盖的模块的确认记录；
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
    const r = appendReviewed(modelRoot, project, reviewedEntries(entity, index, design, at))
    reviewed = { count: r.count, file: r.file, ...(r.pending ? { pending: true } : {}) }
  }
  doc.setIn(['design', 'status'], 'implemented')
  const out = save(file, doc, root, modelRoot, project)
  return { ...out, outcome: verdict.outcome, ...(reviewed ? { reviewed } : {}), ...(promoted ? { promoted } : {}) }
}
