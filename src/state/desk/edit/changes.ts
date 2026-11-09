/**
 * 改动项、AI 回合与撤回的协调（CI-1–CI-7、DA-6、DA-8、DA-9；DL-1、DL-2、DL-3、DL-6、DL-7）：编辑分组的一部分（state.desk.edit）。
 * - 改动项 = 相对基线的对比（derive.vsBaseline）按血缘聚合（模型层 aggregateChanges），带编号表里的号（DL-3）；编号表是一个值，
 *   会话每变一次按「这一步是谁做的」对一次（AI 的一轮记第几轮与 AI，否则记人与已有几轮），随保存写进 designs/<设计>/changes.json。
 * - AI 一轮：改动块里要撤回的号先恢复到基线、再做改动、最后给新框安放位置（DL-6，已有的框不动——没有 layout 的草图先把显示的位置落下），一次性成一步（DL-1）。
 * - 三种撤回（rounds.ts 的纯转移）；有级联时返回要确认的，由呈现层确认后再调（confirmed）。
 * - 改动页签与画布的联动：悬停的号、要居中的号、要滚到的号（只在会话里）。
 */
import { computed, shallowRef, watch, type ShallowRef } from 'vue'
import {
  aggregateChanges,
  buildSketchContext,
  changeEnds,
  EMPTY_CHANGE_TABLE,
  estimateImpact,
  incomingByRelations,
  locateAll,
  numbered,
  parseChangeTable,
  reconcileChanges,
  revertOps,
  ROOT_MOUNT,
  gridLayout,
  validateEditBlock,
  type AgentBlock,
  type ChangeAuthor,
  type ChangeItem,
  type ChangeTable,
  type DesignEditEffects,
  type DesignEditOp,
  type EditBlock,
  type ImpactEstimate,
  type ModelIndex,
  type SketchContext,
  type SketchPoint,
  type Touched,
  type TranscriptProposal,
} from '@/model'
import { placeNewBoxes } from '@/layout/layout'
import type { EditDerivations } from './derive'
import { apply, type EditSession } from './session'
import { applyRound, latestLive, roundState, withdrawItem, withdrawRound, type RoundState } from './rounds'

/** 带号的改动项（页签的一行、图上的一个徽标） */
export type NumberedItem = ChangeItem & { n: number; round: number; by: ChangeAuthor }

/** 提议卡（DA-8）：这一轮动了哪几个号、牵动谁（按当前描述估）；没落时为原因 */
export type ProposalOutcome = TranscriptProposal

/** 要人确认的撤回（级联 / 之后又被改过）：呈现层列出后调 confirm() */
export interface PendingWithdraw {
  title: string
  lines: string[]
  confirm: () => void
}

export interface ChangesInputs {
  session: ShallowRef<EditSession | null>
  derive: EditDerivations
  baseline: () => ModelIndex | null
  current: () => ModelIndex | null
  /** 设计 ID（持久草图没有改动项） */
  design: string | null
  /** 载荷里的编号表（changes.json 原文，没有为 undefined） */
  table: () => unknown
  /** 应用一步之后的跟随（选中、层次）——编辑操作的同一出口 */
  commit: (next: EditSession, effects: DesignEditEffects) => void
  /** 编辑锁的原因（DL-34 设计已认可等、DL-28 AI 回合中）：撤回同样拒绝 */
  locked?: () => string | null
}

export function createChanges(i: ChangesInputs) {
  const { session, derive } = i
  const table = shallowRef<ChangeTable>(parseChangeTable(i.table()))
  /** 改动项（未编号）：相对基线的对比按血缘聚合 */
  const raw = computed<ChangeItem[]>(() => {
    const s = session.value
    const b = i.baseline()
    const c = derive.vsBaseline.value
    if (!s || !b || !c || !i.design) return []
    return aggregateChanges(c.sheets, changeEnds(s.doc.sketches, b))
  })
  /** 这一刻改动的来源：撤销栈顶是 AI 的一轮就记它，否则记人（已有几轮） */
  const attribution = (): { round: number; by: ChangeAuthor } => {
    const s = session.value
    const top = s?.past[s.past.length - 1]
    if (top?.round !== undefined) return { round: top.round, by: 'ai' }
    return { round: s?.rounds.filter(r => roundState(s, r) === 'live').reduce((m, r) => Math.max(m, r.n), 0) ?? 0, by: 'human' }
  }
  watch(
    raw,
    list => {
      if (!session.value) return
      table.value = reconcileChanges(table.value, list, attribution(), new Date().toISOString())
    },
    { flush: 'sync', immediate: true },
  )
  /** 编号表以文件为准再对一次（进入草图、放弃本次改动） */
  const reset = () => {
    table.value = reconcileChanges(parseChangeTable(i.table()), raw.value, attribution(), new Date().toISOString())
  }
  watch(
    () => !!session.value,
    on => on && reset(),
    { flush: 'sync' },
  )

  const items = computed<NumberedItem[]>(() => numbered(table.value, raw.value))
  const byNumber = (n: number) => items.value.find(x => x.n === n)
  /** 图上的徽标：模块 / 关系 → 号（一个框只标它所在的第一项） */
  const badges = computed(() => {
    const modules = new Map<string, number>()
    const relations = new Map<string, number>()
    for (const it of items.value) {
      for (const m of it.modules) if (!modules.has(m)) modules.set(m, it.n)
      for (const r of it.relations) if (!relations.has(r)) relations.set(r, it.n)
    }
    return { modules, relations }
  })
  /** 六类计数（改 ID 与移动分开计，同变更清单 X17） */
  const counts = computed(() => {
    const out: Record<string, number> = {}
    for (const it of items.value) out[it.kind] = (out[it.kind] ?? 0) + 1
    return out
  })

  /** AI 的各轮（状态与它动过的号） */
  const rounds = computed(() => {
    const s = session.value
    if (!s) return []
    return s.rounds.map(r => ({ n: r.n, turn: r.turn, state: roundState(s, r) as RoundState }))
  })
  const latest = computed(() => (session.value ? (latestLive(session.value)?.n ?? null) : null))

  /** DL-7：一组号的影响面（按当前描述估；当前版本描述的关系图——设计里没有代码事实，K8） */
  function impactOf(numbers: readonly number[]): ImpactEstimate | null {
    const s = session.value
    const b = i.baseline()
    const cur = i.current() ?? b
    if (!s || !b || !cur) return null
    const list = items.value.filter(x => numbers.includes(x.n))
    return estimateImpact(list, s.doc.sketches, b, cur, incomingByRelations(cur))
  }

  /** 一轮动过的号：这一轮新出现的号，加上碰过的框 / 关系所在的项 */
  function numbersOfRound(n: number, touched: Touched): number[] {
    const mods = new Set(touched.modules)
    const rels = new Set(touched.relations)
    return items.value
      .filter(
        x =>
          (x.round === n && x.by === 'ai') ||
          x.modules.some(m => mods.has(m)) ||
          x.relations.some(r => rels.has(r)) ||
          x.removed.some(r => mods.has(r) || rels.has(r)),
      )
      .map(x => x.n)
  }

  /**
   * DL-6：新框的安放——这一串操作试算后新出现、还没有位置的模块，按规则安放；所在草图原本没有 layout 时先把显示的位置落下（已有的框不动）。
   * 返回追加的 moveNode 操作（每张草图一条）。
   */
  function placementOps(s: EditSession, ops: readonly DesignEditOp[]): DesignEditOp[] {
    const ctx = derive.ctx.value
    if (!ctx) return []
    const trial = apply(s, [...ops], ctx)
    if (!trial.ok) return []
    const out: DesignEditOp[] = []
    const created = new Set(trial.effects.created)
    for (const [mount, def] of Object.entries(trial.session.doc.sketches)) {
      const before = s.doc.sketches[mount]
      if (!before) continue
      const ids = locateAll(def)
        .filter(m => !(mount === ROOT_MOUNT && m.parentId === undefined))
        .map(m => m.id)
      const fresh = ids.filter(id => created.has(id) && !def.layout?.modules?.[id])
      if (!fresh.length) continue
      const area = mount === s.mount ? derive.scene.value?.gridArea : undefined
      const old = locateAll(before)
        .filter(m => !(mount === ROOT_MOUNT && m.parentId === undefined))
        .map(m => m.id)
        .filter(id => ids.includes(id))
      const spots = { ...(gridLayout(before).modules ?? {}), ...(before.layout?.modules ?? {}) }
      const shown: Record<string, SketchPoint> =
        mount === ROOT_MOUNT ? Object.fromEntries(Object.entries(spots).map(([id, p]) => [id, { x: p.x, y: p.y ?? 0 }])) : derive.shownPositions(before, old)
      const existing = Object.fromEntries(old.filter(id => shown[id]).map(id => [id, shown[id]]))
      const placed = placeNewBoxes(def, existing, fresh, area)
      const positions: Record<string, SketchPoint> = before.layout?.modules ? {} : { ...existing }
      for (const [id, p] of Object.entries(placed)) positions[id] = { x: p.x, y: p.y }
      out.push({ op: 'edit', sketch: mount, edit: { op: 'moveNode', positions } })
    }
    return out
  }

  /**
   * DA-6、DA-9、DL-1：应用 AI 的一轮——改动块里要撤回的号先恢复到基线（「撤回 #3」，不再确认：是人让 AI 撤的），再做改动，最后安放新框；
   * 一次性成一步。任一条做不成整轮不落，提议卡写原因。没有改动块时不出提议卡（undefined）。
   */
  function applyAgentRound(blocks: readonly AgentBlock[], turn: string): ProposalOutcome | undefined {
    const edits = blocks.filter((b): b is EditBlock => b.kind === 'edit')
    if (!edits.length) return undefined
    const s = session.value
    const b = i.baseline()
    const ctx = derive.ctx.value
    if (!s || !ctx) return { kind: 'proposal', applied: false, reasons: ['不在草图里'] }
    const ops: DesignEditOp[] = []
    for (const n of edits.flatMap(e => e.withdraw ?? [])) {
      const it = byNumber(n)
      if (!it || !b) return { kind: 'proposal', applied: false, reasons: [`没有 #${n}（或已撤回）`] }
      const r = revertOps(it, s.doc.sketches, b)
      if (!r.ok) return { kind: 'proposal', applied: false, reasons: [`撤回 #${n}：${r.reason}`] }
      ops.push(...r.ops)
    }
    // DL-21：接入层已校验过；页面应用前再按编辑操作族校验一次（类型由此收窄为 DesignEditOp）
    for (const e of edits) {
      const v = validateEditBlock(e)
      if (!v.ok) return { kind: 'proposal', applied: false, reasons: [v.error] }
      ops.push(...v.value)
    }
    // DL-6：当前张还没有 layout（显示的是一次初始布局）时先把显示的位置落下——已有的框一个不动，合并结果按来源的重心落位（X7j）
    const cur = s.doc.sketches[s.mount]
    const pre: DesignEditOp[] =
      cur && !cur.layout?.modules && s.mount !== ROOT_MOUNT
        ? [
            {
              op: 'edit',
              sketch: s.mount,
              edit: {
                op: 'moveNode',
                positions: derive.shownPositions(
                  cur,
                  locateAll(cur).map(m => m.id),
                ),
              },
            },
          ]
        : []
    const all = [...pre, ...ops]
    const r = applyRound(s, [...all, ...placementOps(s, all)], ctx, turn)
    if (!r.ok) return { kind: 'proposal', applied: false, reasons: [r.reason] }
    i.commit(r.session, r.effects)
    const numbers = numbersOfRound(r.round.n, r.round.touched)
    const est = impactOf(numbers)
    return {
      kind: 'proposal',
      applied: true,
      round: r.round.n,
      numbers,
      impact: { modules: est?.modules.length ?? 0, scenarios: est?.scenarios.length ?? 0, fresh: !!est?.fresh },
    }
  }

  /** 要确认的撤回（级联 / 之后又被改过）；确认后执行、取消清空 */
  const pending = shallowRef<PendingWithdraw | null>(null)
  const label = (key: string) => {
    const it = items.value.find(x => x.key === key)
    return it ? `#${it.n} ${it.summary}` : key
  }

  /** CI-5：撤回一轮（最近一轮 = 撤销；更早的按快照恢复，之后又被改过的先确认） */
  function withdrawRoundNow(n: number, confirmed = false): { ok: boolean; reason?: string } {
    const why = i.locked?.()
    if (why) return { ok: false, reason: why }
    const s = session.value
    const ctx = derive.ctx.value
    if (!s || !ctx) return { ok: false, reason: '不在草图里' }
    const r = withdrawRound(s, n, ctx, confirmed)
    if (!r.ok) {
      if (r.confirm) {
        pending.value = {
          title: `撤回第 ${n} 轮：之后的改动也碰过这些，一并回到第 ${n} 轮开始前`,
          lines: [...r.confirm.modules.map(m => `框 ${derive.nameOf(m) ?? m}`), ...r.confirm.relations.map(x => `关系 ${x}`)],
          confirm: () => {
            pending.value = null
            withdrawRoundNow(n, true)
          },
        }
        return { ok: false, reason: r.reason }
      }
      return r
    }
    i.commit(r.session, r.effects)
    return { ok: true }
  }

  /** CI-5：撤回一项（恢复到基线；别的项依赖它时先确认） */
  function withdrawItemNow(n: number, confirmed = false): { ok: boolean; reason?: string } {
    const why = i.locked?.()
    if (why) return { ok: false, reason: why }
    const s = session.value
    const ctx = derive.ctx.value
    const it = byNumber(n)
    if (!s || !ctx || !it) return { ok: false, reason: it ? '不在草图里' : `没有 #${n}` }
    const r = withdrawItem(s, it, ctx, items.value, confirmed)
    if (!r.ok) {
      if (r.cascade) {
        pending.value = {
          title: `撤回 #${n}：别的改动依赖它，会一起变`,
          lines: r.cascade.map(label),
          confirm: () => {
            pending.value = null
            withdrawItemNow(n, true)
          },
        }
      }
      return { ok: false, reason: r.reason }
    }
    i.commit(r.session, r.effects)
    return { ok: true }
  }

  /** 改动页签与画布的联动（只在会话里）：悬停的号、要画布居中的号、要清单滚到的号 */
  const hover = shallowRef<number | null>(null)
  const focus = shallowRef<{ n: number; seq: number } | null>(null)
  const reveal = shallowRef<{ n: number; seq: number } | null>(null)
  let seq = 0

  /** CI-3：删除项悬停时的虚框——被删的模块在它被删之前最后的位置（撤销栈、各轮快照里找；找不到为空） */
  function ghostOf(n: number): { id: string; mount: string; at: SketchPoint }[] {
    const it = byNumber(n)
    const s = session.value
    if (!it || !s) return []
    const docs = [...s.past.map(st => st.before.sketches), ...s.rounds.map(r => r.before)].reverse()
    const out: { id: string; mount: string; at: SketchPoint }[] = []
    for (const id of it.removed) {
      for (const d of docs) {
        const p = d[it.mount]?.layout?.modules?.[id]
        if (p) {
          out.push({ id, mount: it.mount, at: { x: p.x, y: p.y ?? 0 } })
          break
        }
      }
    }
    return out
  }

  /** DL-14：给 agent 的草图上下文（当前张、其他草图、基线同层、带号的改动清单、父模块原则） */
  function context(): SketchContext | null {
    const s = session.value
    if (!s || !i.design) return null
    return buildSketchContext({
      design: i.design,
      mount: s.mount,
      sketches: s.doc.sketches,
      baseline: i.baseline(),
      current: i.current(),
      changes: items.value,
    })
  }

  return {
    table,
    /** 保存时写进 changes.json 的表 */
    tableForSave: () => (i.design ? table.value : null),
    reset,
    items,
    badges,
    counts,
    rounds,
    latest,
    impactOf,
    applyAgentRound,
    withdrawRound: withdrawRoundNow,
    withdrawItem: withdrawItemNow,
    pending,
    cancelPending: () => (pending.value = null),
    hover,
    setHover: (n: number | null) => (hover.value = n),
    focus,
    /** 单击页签的一行：画布切到那张草图并居中 */
    focusItem: (n: number) => (focus.value = { n, seq: ++seq }),
    reveal,
    /** 单击画布上的徽标：清单滚到那一行 */
    revealItem: (n: number) => (reveal.value = { n, seq: ++seq }),
    ghostOf,
    context,
    byNumber,
  }
}

export type ChangesGroup = ReturnType<typeof createChanges>
export { EMPTY_CHANGE_TABLE }
