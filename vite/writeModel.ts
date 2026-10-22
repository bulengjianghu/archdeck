/**
 * 描述写入（B1–B5，ADR-0019）：页面只能追加人拥有的三类内容——设计某一轮的评审意见（design.yaml feedback）、
 * 架构规则的例外（rules.yaml 的 rules.allow）、源码忽略项（source-ignore.yaml 的 sourceIgnore）。
 * AI 生成的部分（modules/、scenarios/、system.yaml 等）不写。只追加、不删改；用 YAML 文档模型修改，保留注释与其他内容。
 * 写后由开发服务器的文件监听推送 arch-model:changed，页面按 N5 重新加载。
 */
import fs from 'node:fs'
import path from 'node:path'
import { isMap, isSeq, parseDocument, type Document } from 'yaml'
import { RULE_KINDS, loadModel, type RuleKind } from '../src/model'
import { DESIGNS_DIR, isProjectId, readModelDir } from './readModelDir'

export class WriteError extends Error {}

export type WriteResult = { file: string }

const today = () => new Date().toISOString().slice(0, 10)

function openDoc(file: string, empty: string): Document {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : empty
  const doc = parseDocument(text)
  if (doc.errors.length) throw new WriteError(`${path.basename(file)} 解析失败：${doc.errors[0].message.split('\n')[0]}，请先修好再写`)
  return doc
}

function save(file: string, doc: Document, root: string): WriteResult {
  fs.writeFileSync(file, doc.toString({ lineWidth: 0 }))
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
  return save(file, doc, root)
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
  return save(file, doc, root)
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
  return save(file, doc, root)
}
