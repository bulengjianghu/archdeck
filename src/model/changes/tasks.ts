/**
 * 任务单（TK-2–TK-4，DL-36、DL-37，ADR-0063 决策 3）：认可后的「改动」页签原号不变地变成任务单——
 * 每一项是「代码现在是这样、草图要它变成那样」的一条差别，附怎样算做到（对应的核验条目）；状态由核验推出，不接受人工勾选。
 * 设计开始前基线 = 当前版本，所以相对基线的改动项与相对当前版本的偏差是同一批；偏差按实体 ID 归到改动项，归不到的单列「对不上号」。
 * 纯函数：命令行、MCP 与页面同一份结果。
 */
import type { DesignApproval, DesignStatus } from '../design'
import type { SketchCheck, SketchDeviation, SketchSet } from '../intent/types'
import type { SketchChange } from '../intent/check'
import { CHANGE_KIND_LABELS, type ChangeKind, type ModelIndex } from '../types'
import { changeItems, type ChangeItem } from './items'
import { activeNumbers, type ChangeAuthor, type ChangeTable } from './numbering'

/** 一项的状态：✓（偏差消失）/ 待做（还在）/ 不核验（核验比不到的改动，由评审看） */
export type TaskState = 'done' | 'todo' | 'unchecked'

export const TASK_STATE_LABELS: Record<TaskState, string> = { done: '✓', todo: '待做', unchecked: '不核验' }

/** 任务单的有效性（DL-37）：按设计状态 */
export type TaskListState = 'active' | 'withdrawn' | 'preview' | 'void' | 'archived'

export interface TaskCriterion {
  /** 怎样算做到 */
  text: string
  /** 对应的核验代码（sketch.*）；不核验的为空 */
  codes: string[]
}

/** DL-46：任务单行的次序——待做 → 不核验 → ✓ */
export const TASK_ORDER: Record<TaskState, number> = { todo: 0, unchecked: 1, done: 2 }

export interface TaskRow {
  /** 改动项号；编号表里没有的为 null（「未编号」） */
  n: number | null
  key: string
  kind: ChangeKind
  entity: ChangeItem['entity']
  id: string
  mount: string
  summary: string
  round?: number
  by?: ChangeAuthor
  state: TaskState
  /** 验收标准：每处可核验的变更一条；不核验的一条说明 */
  criteria: TaskCriterion[]
  /** 待做：还在的偏差 */
  remaining: { key: string; code: string; message: string }[]
}

export interface TaskList {
  design: string
  name: string
  status: DesignStatus
  state: TaskListState
  /** 任务单头的一句话 */
  note: string
  /** 认可日期（有效时）与撤回日期（撤回时） */
  approvedAt?: string
  withdrawnAt?: string
  rows: TaskRow[]
  /** 归不到任何改动项的偏差（DL-36） */
  unmatched: { key: string; code: string; message: string; reason: string }[]
  counts: Record<TaskState, number> & { unmatched: number }
}

export interface TaskInput {
  design: string
  name?: string
  status: DesignStatus
  approval?: DesignApproval
  sketches: SketchSet
  /** 设计的基线（base.commit 那一版；没有时为当前版本） */
  baseline: ModelIndex
  /** 编号表（changes.json） */
  table: ChangeTable
  /** 设计各张草图对当前版本的核验（X4，带基线以查「删掉的仍在」，带认可的偏差） */
  checks: readonly SketchCheck[]
}

/** 相对当前版本比得到的结构字段（X17：文字只参与相对基线） */
const STRUCTURAL_MODULE_FIELDS = new Set(['parent', 'kind', 'role', 'mayDependOn'])

/** 偏差落在哪个实体上：键 `<种类>:<实体>`；端口的实现者写成 `<接口>#<模块>` */
export function deviationEntity(d: Pick<SketchDeviation, 'key'>): string {
  const id = d.key.slice(d.key.indexOf(':') + 1)
  return id.includes('#') ? id.slice(0, id.indexOf('#')) : id
}

/** 改动项牵涉的实体：设计侧模块、关系、删除的基线实体、血缘来源与拆分结果 */
function touched(item: ChangeItem): Set<string> {
  const out = new Set([item.id, ...item.modules, ...item.relations, ...item.removed])
  for (const p of item.parts) {
    out.add(p.id)
    for (const x of [...(p.from ?? []), ...(p.to ?? [])]) out.add(x)
  }
  return out
}

/** 一处变更对应的核验条目（怎样算做到）；核验比不到的为 null */
function criterion(c: SketchChange): TaskCriterion | null {
  const list = (xs: readonly string[] | undefined) => (xs ?? []).join('、')
  if (c.entity === 'module') {
    if (c.kind === 'added') return { text: `当前版本里有模块 ${c.id}（${c.name}）`, codes: ['sketch.missing-module'] }
    if (c.kind === 'merged') return { text: `当前版本里有 ${c.id}（${c.name}），${list(c.from)} 不再单独存在`, codes: ['sketch.missing-module', 'sketch.not-applied'] }
    if (c.kind === 'split') return { text: `当前版本里有 ${list(c.to)}，${c.id} 不再存在`, codes: ['sketch.missing-module', 'sketch.not-applied'] }
    if (c.kind === 'renamed' || c.kind === 'moved')
      return { text: `当前版本里是 ${c.id}（${c.name}），${list(c.from)} 不在原处`, codes: ['sketch.missing-module', 'sketch.not-applied'] }
    if (c.kind === 'removed') return { text: `当前版本里没有 ${c.id}（${c.name}）`, codes: ['sketch.not-removed'] }
    const fields = (c.fields ?? []).filter(f => STRUCTURAL_MODULE_FIELDS.has(f))
    return fields.length ? { text: `${c.id}（${c.name}）的 ${fields.join('、')} 与草图一致`, codes: ['sketch.field'] } : null
  }
  if (c.entity === 'relation') {
    if (c.kind === 'added' || (c.kind === 'changed' && (c.fields ?? []).some(f => f === 'from' || f === 'to' || f === 'type')))
      return { text: `当前版本有关系 ${c.name}（同两端与类型，或两端子树之间的同类关系）`, codes: ['sketch.missing-relation'] }
    return null
  }
  if (c.kind === 'added') return { text: `当前版本有接口 ${c.name}（${c.id}）`, codes: ['sketch.missing-interface'] }
  if (c.kind === 'changed' && c.fields?.includes('owner')) return { text: `接口 ${c.name} 的提供方与草图一致`, codes: ['sketch.interface-owner'] }
  return null
}

/** 不核验的说明 */
function uncheckedText(item: ChangeItem): string {
  if (item.entity === 'relation' && item.kind === 'removed') return '删除关系不进核验（X4 只比草图写了的）：由评审确认代码里已没有这条交互'
  return `只改了文字或核验比不到的字段（${(item.fields ?? []).join('、') || '—'}；相对当前版本只比结构，X17）：由评审看`
}

/** DL-37：任务单头 */
function headOf(i: TaskInput): Pick<TaskList, 'state' | 'note' | 'approvedAt' | 'withdrawnAt'> {
  const a = i.approval
  if (i.status === 'accepted') return { state: 'active', note: `有效：认可于 ${a?.at ?? '（日期未记）'}`, ...(a?.at ? { approvedAt: a.at } : {}) }
  if (i.status === 'abandoned') return { state: 'void', note: '作废：设计已放弃' }
  if (i.status === 'implemented') return { state: 'archived', note: '已归档：设计已实现' }
  if (a?.withdrawnAt) return { state: 'withdrawn', note: `认可已撤回（${a.withdrawnAt}）：重新认可后再复制`, withdrawnAt: a.withdrawnAt }
  return { state: 'preview', note: '还没认可：只是预览，不是任务单' }
}

/** DL-36：任务单——改动项带号、状态由核验推出、对不上号的偏差单列 */
export function taskList(i: TaskInput): TaskList {
  const items = changeItems(i.sketches, i.baseline, i.design, 'baseline')
  const numbers = activeNumbers(i.table)
  const open = i.checks.flatMap(c => c.deviations).filter(d => d.severity !== 'info')
  // 偏差归到改动项：先按实体 ID 精确归；归不到的再看关系的两端（取草图里的定义）或所在的模块是不是某项设计侧模块的后代
  // （改 ID、合并时随之重指向的关系与下一层，相对基线被血缘吸收、不另成项）
  const rels = new Map(Object.values(i.sketches).flatMap(d => (d.relations ?? []).map(r => [r.id, [r.from, r.to]] as const)))
  const owner = new Map<SketchDeviation, ChangeItem>()
  for (const d of open) {
    const e = deviationEntity(d)
    const hit = items.find(it => touched(it).has(e))
    if (hit) owner.set(d, hit)
  }
  for (const d of open) {
    if (owner.has(d)) continue
    const e = deviationEntity(d)
    const at = rels.get(e) ?? [e]
    const under = (m: string) => at.some(x => x === m || x.startsWith(`${m}.`))
    const hit = items.find(it => it.kind !== 'removed' && it.entity === 'module' && it.modules.some(under))
    if (hit) owner.set(d, hit)
  }
  const rows: TaskRow[] = items.map(item => {
    const rec = numbers.get(item.key)
    const mine = open.filter(d => owner.get(d) === item)
    const criteria = item.parts.map(criterion).filter((x): x is TaskCriterion => !!x)
    const state: TaskState = mine.length ? 'todo' : criteria.length ? 'done' : 'unchecked'
    return {
      n: rec?.n ?? null,
      key: item.key,
      kind: item.kind,
      entity: item.entity,
      id: item.id,
      mount: item.mount,
      summary: item.summary,
      ...(rec ? { round: rec.round, by: rec.by } : {}),
      state,
      criteria: criteria.length ? criteria : [{ text: uncheckedText(item), codes: [] }],
      remaining: mine.map(d => ({ key: d.key, code: d.code, message: d.message })),
    }
  })
  // DL-46：待做在前、不核验其次、✓ 留在最后；同一态内按号
  rows.sort((a, b) => TASK_ORDER[a.state] - TASK_ORDER[b.state] || (a.n ?? Infinity) - (b.n ?? Infinity) || a.key.localeCompare(b.key))
  const unmatched = open
    .filter(d => !owner.has(d))
    .map(d => ({
      key: d.key,
      code: d.code,
      message: d.message,
      reason: '归不到任何改动项：设计开始后当前版本在这处另有变化（基线 = 设计开始时的当前版本），或这处改动不是在页面里编的号',
    }))
  const counts = { done: 0, todo: 0, unchecked: 0, unmatched: unmatched.length }
  for (const r of rows) counts[r.state]++
  return { design: i.design, name: i.name ?? i.design, status: i.status, ...headOf(i), rows, unmatched, counts }
}

/** DL-37：给写代码的 agent 的 Markdown（复制）；与返工清单（AG-4）区分：这是「把代码改到草图那样」 */
export function taskMarkdown(t: TaskList): string {
  const out: string[] = [
    `# 任务单：设计「${t.name}」（${t.design}）`,
    '',
    `> ${t.note}`,
    '>',
    '> 这是任务单，不是问题清单：每一项是「代码现在是这样、草图要它变成那样」的一条差别。把代码改到位、重新生成当前描述后，架构台按核验自动重算——偏差消失即 ✓，还在即「待做」；不要手工勾选，也不要改草图、规则与确认记录。',
    '',
    `进度：✓ ${t.counts.done} · 待做 ${t.counts.todo} · 不核验 ${t.counts.unchecked}${t.counts.unmatched ? ` · 对不上号 ${t.counts.unmatched}` : ''}`,
    '',
  ]
  for (const r of t.rows) {
    out.push(`## ${r.n === null ? '（未编号）' : `#${r.n}`} ${TASK_STATE_LABELS[r.state]} · ${CHANGE_KIND_LABELS[r.kind]} · ${r.summary}`, '')
    out.push(`- 挂在：${r.mount}${r.round !== undefined ? ` · 第 ${r.round} 轮 · ${r.by === 'ai' ? 'AI' : '人'}` : ''}`)
    for (const c of r.criteria) out.push(`- 怎样算做到：${c.text}${c.codes.length ? `（核验 ${c.codes.join(' / ')}）` : ''}`)
    for (const d of r.remaining) out.push(`- 还差：${d.message}（${d.code}）`)
    out.push('')
  }
  if (t.unmatched.length) {
    out.push('## 对不上号的偏差', '')
    for (const d of t.unmatched) out.push(`- ${d.message}（${d.code}）——${d.reason}`)
    out.push('')
  }
  return out.join('\n')
}
