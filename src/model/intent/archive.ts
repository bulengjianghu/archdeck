/**
 * 归档的判定与「估与实际」（DL-47、DL-49，TK-5、TK-6，ADR-0063 决策 4、9）：三关——核验一致（X4）、棘轮无新增（U8）、
 * 草图指纹与认可记录一致（DL-35）——各给一行结论；认可时记下的影响面与实际改了的模块对比。纯函数：
 * 核验、门禁错误、指纹比对与描述指纹都由调用方算好传进来（页面、写端点、命令行同一套）。
 */
import type { DesignEstimate, DesignStatus } from '../design'
import { driftText, type ApprovalDrift, type TransitionContext } from './approval'
import { archiveVerdict } from './lifecycle'
import type { SketchCheck } from './types'

export type ArchiveGateKey = 'consistent' | 'ratchet' | 'drift'

export interface ArchiveGate {
  key: ArchiveGateKey
  /** 关名（任务单头、归档预览） */
  label: string
  ok: boolean
  /** 一句说明：过时说过了什么，不过时说差在哪 */
  detail: string
  /** 没判（棘轮要算整份代码事实，前后两关没过时不算） */
  skipped?: boolean
}

export interface ArchiveGates {
  gates: ArchiveGate[]
  /** 三关全绿 */
  ok: boolean
  /** 第一道没过的关（「归档」灰时的提示） */
  first: ArchiveGate | null
}

export const ARCHIVE_GATE_LABELS: Record<ArchiveGateKey, string> = { consistent: '核验一致', ratchet: '棘轮无新增', drift: '草图指纹一致' }

export interface ArchiveGateInput {
  /** 本设计各张草图对当前版本的核验（按原严重度，DL-45 的门禁降级不作用于这里） */
  checks: readonly SketchCheck[]
  /** 当前版本的门禁错误（U8：rule.new、cycle.grew）；代码事实不可得时为 null；没算（undefined）时这一关记「暂不判」 */
  gateErrors?: readonly { message: string }[] | null
  /** gateErrors 为 null 时的原因 */
  ratchetUnknown?: string
  /** 认可指纹比对（DL-35） */
  drift: ApprovalDrift
}

/**
 * DL-47：棘轮要不要算——它要读整份源码算治理报告（秒级），核验一致与草图指纹两关都过了才值得算；
 * 调用方先用 needsRatchet 判，再决定传不传 gateErrors
 */
export const needsRatchet = (checks: readonly SketchCheck[], drift: ApprovalDrift): boolean => !!checks.length && checks.every(c => archiveVerdict(c).ok) && drift.intact

/** DL-47：三关各一行 */
export function archiveGates(input: ArchiveGateInput): ArchiveGates {
  const verdicts = input.checks.map(archiveVerdict)
  const bad = verdicts.find(v => !v.ok)
  const consistent: ArchiveGate = !input.checks.length
    ? { key: 'consistent', label: ARCHIVE_GATE_LABELS.consistent, ok: false, detail: '设计没有草图，没有可核验的意图' }
    : bad
      ? { key: 'consistent', label: ARCHIVE_GATE_LABELS.consistent, ok: false, detail: `草图「${bad.check.mount ?? bad.check.sketch}」${bad.reason}` }
      : { key: 'consistent', label: ARCHIVE_GATE_LABELS.consistent, ok: true, detail: `${input.checks.length} 张草图与当前版本一致` }
  const errs = input.gateErrors
  const ratchet: ArchiveGate =
    errs === undefined
      ? { key: 'ratchet', label: ARCHIVE_GATE_LABELS.ratchet, ok: false, skipped: true, detail: '核验一致与草图指纹两关过了再判' }
      : errs === null
      ? { key: 'ratchet', label: ARCHIVE_GATE_LABELS.ratchet, ok: false, detail: input.ratchetUnknown ?? '代码事实不可得，判断不了棘轮' }
      : errs.length
        ? { key: 'ratchet', label: ARCHIVE_GATE_LABELS.ratchet, ok: false, detail: `规则有 ${errs.length} 条新违反：${errs[0].message}` }
        : { key: 'ratchet', label: ARCHIVE_GATE_LABELS.ratchet, ok: true, detail: '规则没有新违反' }
  const drift: ArchiveGate = { key: 'drift', label: ARCHIVE_GATE_LABELS.drift, ok: input.drift.intact, detail: driftText(input.drift) }
  const gates = [consistent, ratchet, drift]
  // 第一道没过的关：判过的优先（暂不判的棘轮不挡在没过的指纹关前面）
  const first = gates.find(g => !g.ok && !g.skipped) ?? gates.find(g => !g.ok) ?? null
  return { gates, ok: !first, first }
}

/** 三关的结果交给迁移表（DL-32）的条件 */
export const gateContext = (g: ArchiveGates, drift: ApprovalDrift): TransitionContext => ({
  consistent: g.gates[0].ok,
  ratchet: g.gates[1].ok,
  drift,
})

/** DL-49：两份「模块 → 描述指纹」之间改了、删了、新加的模块（各自按 ID 排序） */
export function changedModules(before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>) {
  const changed = Object.keys(before)
    .filter(id => id in after && after[id] !== before[id])
    .sort()
  const removed = Object.keys(before)
    .filter(id => !(id in after))
    .sort()
  const added = Object.keys(after)
    .filter(id => !(id in before))
    .sort()
  return { changed, removed, added }
}

export interface EstimateGap {
  /** 认可时记下了估算 */
  recorded: boolean
  /** 估牵动的模块数；全是新框时为 null（「新」，不给数） */
  estimated: number | null
  /** 实际：改了与删了的 + 新加的 */
  actual: number
  /** 认可时就有、描述变了或删了的 */
  touched: string[]
  /** 新加的模块 */
  added: string[]
  /** 估了没改 */
  spared: string[]
  /** 改了没估 */
  missed: string[]
}

/** DL-49：认可时的估算与此刻当前版本的描述指纹对比 */
export function estimateGap(estimate: DesignEstimate | undefined, now: Readonly<Record<string, string>>): EstimateGap {
  if (!estimate) return { recorded: false, estimated: null, actual: 0, touched: [], added: [], spared: [], missed: [] }
  const { changed, removed, added } = changedModules(estimate.current, now)
  const touched = [...changed, ...removed].sort()
  const est = new Set(estimate.modules)
  const hit = new Set(touched)
  return {
    recorded: true,
    estimated: estimate.fresh ? null : estimate.modules.length,
    actual: touched.length + added.length,
    touched,
    added,
    spared: [...est].filter(id => !hit.has(id)).sort(),
    missed: touched.filter(id => !est.has(id)),
  }
}

/** 归档预览的一行：「认可时估牵动 N · 实际改了 N′」 */
export function gapLine(g: EstimateGap): string {
  if (!g.recorded) return '认可时没有记下估算，无从比对'
  return `认可时估牵动 ${g.estimated === null ? '新' : g.estimated} · 实际改了 ${g.actual}${g.added.length ? `（其中新加 ${g.added.length}）` : ''}`
}

/** DL-50：归档预览（写端点算、页面与命令行同一份）——三关、估与实际、将写确认记录的模块、将晋升替换的持久草图；不能归档时带原因 */
export interface ArchivePreview {
  status: DesignStatus
  gates: ArchiveGates
  gap: EstimateGap
  covered: string[]
  promotes: string[]
  reason?: string
}
