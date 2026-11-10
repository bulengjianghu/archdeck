/**
 * AI 回合与三种撤回（DA-6、DA-9、CI-5，DL-1、DL-2；ADR-0063 决策 1、6）：编辑会话上的纯转移。
 * - 一轮：AI 说完时，这一轮的操作（先做它要撤回的号，再做它的改动，最后安放新框）一次性应用为设计级撤销的一步，记下开始前的快照与碰过的东西。
 * - 撤回最近一轮 = 一步撤销（它的那一步在撤销栈顶时）；撤回更早一轮 = 把那一轮碰过的模块与关系恢复成那一轮开始前的快照，
 *   之后又被改过的先列出来确认；撤回一项 = 恢复到基线（模型层 revertPlan），别的项因此消失或变了的先列出来确认。后两种都是一步普通编辑，可反悔。
 */
import {
  laterTouched,
  restoreRoundOps,
  revertPlan,
  touchedBetween,
  type ChangeItem,
  type DesignEditContext,
  type DesignEditEffects,
  type DesignEditOp,
  type ModelIndex,
  type Touched,
} from '@/model'
import { apply, undo, type ApplyOutcome, type EditSession, type Round } from './session'

/** 一轮在此刻的状态：在（结果还在）、已撤销（它的那一步在重做栈里）、已撤回（按快照恢复过） */
export type RoundState = 'live' | 'undone' | 'withdrawn'

export function roundState(s: EditSession, r: Round): RoundState {
  if (r.withdrawn) return 'withdrawn'
  if (s.future.some(st => st.round === r.n)) return 'undone'
  return 'live'
}

/** 下一轮的序号 */
export const nextRound = (s: EditSession): number => (s.rounds[s.rounds.length - 1]?.n ?? 0) + 1

/** 最近一轮还在的轮（撤回本轮的对象） */
export const latestLive = (s: EditSession): Round | null => [...s.rounds].reverse().find(r => roundState(s, r) === 'live') ?? null

/** DL-1：应用一轮——操作一次性成一步，记下快照；任一条做不成整轮不落 */
export function applyRound(
  s: EditSession,
  ops: readonly DesignEditOp[],
  ctx: DesignEditContext,
  turn: string,
): (ApplyOutcome & { ok: true; round: Round }) | Extract<ApplyOutcome, { ok: false }> {
  if (!ops.length) return { ok: false, code: 'invalid', reason: '这一轮没有改动' }
  const n = nextRound(s)
  const r = apply(s, [...ops], ctx, { round: n })
  if (!r.ok) return r
  const round: Round = { n, turn, before: s.doc.sketches, after: r.session.doc.sketches, touched: touchedBetween(s.doc.sketches, r.session.doc.sketches) }
  return { ...r, session: { ...r.session, rounds: [...s.rounds, round] }, round }
}

/** 撤回一轮的方案：栈顶就是它 → 一步撤销；否则按快照恢复（之后又被改过的要确认） */
export type RoundWithdrawPlan = { kind: 'undo' } | { kind: 'restore'; ops: DesignEditOp[]; conflicts: Touched } | { kind: 'none'; reason: string }

export function planWithdrawRound(s: EditSession, n: number): RoundWithdrawPlan {
  const r = s.rounds.find(x => x.n === n)
  if (!r) return { kind: 'none', reason: `没有第 ${n} 轮` }
  const state = roundState(s, r)
  if (state !== 'live') return { kind: 'none', reason: state === 'undone' ? `第 ${n} 轮已撤销（可重做）` : `第 ${n} 轮已撤回` }
  const top = s.past[s.past.length - 1]
  if (top?.round === n) return { kind: 'undo' }
  const ops = restoreRoundOps(r.before, r.touched)
  if (!ops.length) return { kind: 'none', reason: `第 ${n} 轮没有留下改动` }
  return { kind: 'restore', ops, conflicts: laterTouched(r.touched, r.after, s.doc.sketches) }
}

export type WithdrawOutcome = { ok: true; session: EditSession; effects: DesignEditEffects } | { ok: false; reason: string; confirm?: Touched }

/**
 * CI-5：撤回一轮。confirmed 为 false 且之后又被改过时不做，返回要确认的；撤回最近一轮 = 撤销（可重做）；更早的按快照恢复成一步新编辑。
 */
export function withdrawRound(s: EditSession, n: number, ctx: DesignEditContext, confirmed = false): WithdrawOutcome {
  const plan = planWithdrawRound(s, n)
  if (plan.kind === 'none') return { ok: false, reason: plan.reason }
  if (plan.kind === 'undo') {
    const u = undo(s)
    return u ? { ok: true, session: u.session, effects: u.effects } : { ok: false, reason: '没有可撤销的' }
  }
  if (!confirmed && (plan.conflicts.modules.length || plan.conflicts.relations.length))
    return { ok: false, reason: '之后的改动也碰过这些框', confirm: plan.conflicts }
  const r = apply(s, plan.ops, ctx)
  if (!r.ok) return { ok: false, reason: r.reason }
  return { ok: true, session: { ...r.session, rounds: r.session.rounds.map(x => (x.n === n ? { ...x, withdrawn: true } : x)) }, effects: r.effects }
}

/** 撤回一项的方案（DL-2）：逆向操作与级联（别的项因此消失或变了） */
export type ItemWithdrawPlan = { ok: true; ops: DesignEditOp[]; dropped: string[]; altered: string[] } | { ok: false; reason: string }

export function planWithdrawItem(s: EditSession, item: ChangeItem, ctx: DesignEditContext, items: readonly ChangeItem[]): ItemWithdrawPlan {
  if (!ctx.baseline) return { ok: false, reason: '没有基线：不能恢复到基线' }
  const p = revertPlan(item, s.doc.sketches, { ...ctx, baseline: ctx.baseline as ModelIndex }, items)
  return p.ok ? { ok: true, ops: p.plan.ops, dropped: p.plan.dropped, altered: p.plan.altered } : p
}

/** CI-5：撤回一项 = 恢复到基线，一步普通编辑；有级联且没确认时不做 */
export function withdrawItem(
  s: EditSession,
  item: ChangeItem,
  ctx: DesignEditContext,
  items: readonly ChangeItem[],
  confirmed = false,
): { ok: true; session: EditSession; effects: DesignEditEffects } | { ok: false; reason: string; cascade?: string[] } {
  const plan = planWithdrawItem(s, item, ctx, items)
  if (!plan.ok) return plan
  const cascade = [...plan.dropped, ...plan.altered]
  if (cascade.length && !confirmed) return { ok: false, reason: '别的改动依赖它', cascade }
  const r = apply(s, plan.ops, ctx)
  return r.ok ? { ok: true, session: r.session, effects: r.effects } : { ok: false, reason: r.reason }
}
