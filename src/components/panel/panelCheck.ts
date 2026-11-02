/**
 * 属性栏的核对卡（PC-2、PC-6、PC-7，V15b）：「描述可信吗、健康吗」——分项一行一个状态加一句结论，异常行下平铺出问题的条目。
 * 输入全部来自现有派生（各面板从 desk.facts / review / evolution 取），这里只定状态、结论句与卡头结论，不新算。
 */
import type { RelationType } from '@/model'
import { RELATION_TYPE_LABELS } from '../shared/labels'
import { orderNotices, type PanelNotice } from './panelNotices'

/** 关系类型的显示名（核对条目与协作行共用，取自呈现共用件的文案） */
export const relationTypeLabel = (t: RelationType): string => RELATION_TYPE_LABELS[t]

/** ⚠ 要看（bad 问题级、hint 提示级）/ ✓ 正常 / — 不适用（没有代码事实、未确认等） */
export type CheckState = 'bad' | 'hint' | 'ok' | 'none'

/** 异常行下的一条：单击跳到清单（data-sec）或选中一条关系 */
export interface CheckItem {
  text: string
  /** 跳转目标清单的 data-sec */
  target?: string
  /** 选中这条关系 */
  relation?: string
  /** 提示级条目（警示色） */
  hint?: boolean
  /** 口径说明（悬停；PC-7：条目只写信号与数字，口径不占行） */
  title?: string
}

export interface CheckRow {
  key: string
  label: string
  state: CheckState
  text: string
  items: CheckItem[]
  /** 结论句的口径说明（悬停；如治理行的基线日期、环度趋势） */
  title?: string
}

/** PC-7：异常行下至多平铺的条数，其余收「+N」 */
export const CHECK_ITEMS_CAP = 5

export const isWarn = (s: CheckState) => s === 'bad' || s === 'hint'

/** PC-2：卡头结论——「⚠ N 项要看 · ✓ M 项正常」，为 0 的一半不写；— 行不计，全是 — 时为「暂无核对结果」 */
export function checkSummary(rows: readonly CheckRow[]): { warn: number; ok: number; text: string } {
  const warn = rows.filter(r => isWarn(r.state)).length
  const ok = rows.filter(r => r.state === 'ok').length
  const parts = [...(warn ? [`⚠ ${warn} 项要看`] : []), ...(ok ? [`✓ ${ok} 项正常`] : [])]
  return { warn, ok, text: parts.length ? parts.join(' · ') : '暂无核对结果' }
}

/** 有 bad 条目的行为 bad，只有提示级的为 hint */
const stateOf = (items: readonly CheckItem[]): CheckState => (!items.length ? 'ok' : items.some(i => !i.hint) ? 'bad' : 'hint')

/** PC-6：模块核对卡六行的输入（条目文字由面板按名称写好） */
export interface ModuleCheckInput {
  /** 有代码事实（K8）；没有时前四行为 — */
  facts: boolean
  /** 没有代码事实的原因（— 行的结论） */
  noFactsReason?: string
  /** 跨子树边界的关系条数（证实一行的分母） */
  relations: number
  /** 未证实且两端无依赖的交互（K6） */
  unconfirmed: CheckItem[]
  /** 未解释的交互（K7） */
  undescribed: CheckItem[]
  violations: CheckItem[]
  cycles: CheckItem[]
  /** 逆稳定（U17，提示级） */
  against: CheckItem[]
  /** 表面宽度 W（没有入口时 null） */
  surfaceWidth: number | null
  /** 越过入口、热表面未声明（U18 / U19，提示级） */
  surface: CheckItem[]
  /** 拆分信号（K21，提示级） */
  split: CheckItem[]
  /** 演化：修改次数与热度；没有演化数据时 null */
  evolution: { changes: number; fixes: number; heat: number | null; days?: number } | null
  /** 确认（Z3）：已确认带日期；需复核带改动处数；未确认 */
  review: { status: 'reviewed' | 'stale' | 'unreviewed'; date?: string; changes?: number; inScope: boolean }
  /** EX-7：本模块图解的依据过期（「基于旧描述 · N 处改动」或「未记录依据」）；没有图解或依据一致时省略 */
  explainerStale?: string
}

/** PC-6：模块核对卡的六行，次序固定 */
export function moduleCheckRows(x: ModuleCheckInput): CheckRow[] {
  const none = (key: string, label: string): CheckRow => ({ key, label, state: 'none', text: x.noFactsReason ?? '没有代码事实', items: [] })
  const rows: CheckRow[] = []
  if (!x.facts) rows.push(none('verify', '证实'), none('governance', '治理'), none('surface', '表面'), none('split', '拆分'))
  else {
    const verify = [...x.unconfirmed, ...x.undescribed]
    rows.push({
      key: 'verify',
      label: '证实',
      state: stateOf(verify),
      text: verify.length
        ? [
            ...(x.unconfirmed.length ? [`${x.relations} 条交互中 ${x.unconfirmed.length} 条未证实`] : []),
            ...(x.undescribed.length ? [`${x.undescribed.length} 处未解释的交互`] : []),
          ].join(' · ')
        : x.relations
          ? `${x.relations} 条交互全部被代码证实`
          : '没有跨边界的交互',
      items: verify,
    })
    const gov = [...x.violations, ...x.cycles, ...x.against.map(i => ({ ...i, hint: true }))]
    rows.push({
      key: 'governance',
      label: '治理',
      state: stateOf(gov),
      text: `违规 ${x.violations.length} · 环 ${x.cycles.length}${x.against.length ? ` · 逆稳定 ${x.against.length}` : ''}`,
      items: gov,
    })
    const surface = x.surface.map(i => ({ ...i, hint: true }))
    rows.push({
      key: 'surface',
      label: '表面',
      state: stateOf(surface),
      text: `${x.surfaceWidth !== null ? `W ${x.surfaceWidth} · ` : ''}${surface.length ? `${surface.length} 处提示` : '无越过入口'}`,
      items: surface,
    })
    const split = x.split.map(i => ({ ...i, hint: true }))
    rows.push({ key: 'split', label: '拆分', state: stateOf(split), text: split.length ? `${split.length} 个拆分信号` : '无', items: split })
  }
  const e = x.evolution
  rows.push({
    key: 'evolution',
    label: '演化',
    state: e ? 'ok' : 'none',
    text: e
      ? `${e.days ? `近 ${e.days} 天` : ''}修改 ${e.changes} 次${e.fixes ? ` · 缺陷 ${e.fixes}` : ''}${e.heat !== null ? ` · 热度 ${e.heat}` : ''}`
      : '没有演化数据',
    items: [],
  })
  const r = x.review
  const review: CheckRow =
    r.status === 'stale'
      ? {
          key: 'review',
          label: '确认',
          state: 'bad',
          text: `确认已过期 · ${r.changes ?? 1} 处改动`,
          items: [{ text: `确认后描述改动 ${r.changes ?? 1} 处`, target: 'review.diff' }],
        }
      : r.status === 'reviewed'
        ? { key: 'review', label: '确认', state: 'ok', text: `${r.date ?? ''} 已确认`.trim(), items: [] }
        : { key: 'review', label: '确认', state: 'none', text: r.inScope ? '从未确认' : '未确认（不在确认范围）', items: [] }
  // EX-7：图解基于旧描述与「确认过期」是同一套机制，提示级细节落在这一行
  if (x.explainerStale)
    rows.push({
      ...review,
      state: review.state === 'bad' ? 'bad' : 'hint',
      items: [...review.items, { text: `图解${x.explainerStale}`, target: 'review.explainer', hint: true }],
    })
  else rows.push(review)
  return rows
}

/** PC-10：其他对象的一行——由面板已有的信号清单（PanelNotice）落到行上 */
export interface NoticeRowDef {
  key: string
  label: string
  /** 落到这一行的信号 */
  notices: readonly string[]
  /** 没有信号时的结论；undefined 表示这一行不适用（—） */
  ok?: string
  /** 不适用时的结论 */
  none?: string
  /** 有信号时的结论句（缺省为「信号 计数」并列）；系统面板的治理行用它写「违规 新增 N · 存量 M · 模块环 K」 */
  text?: string
  /** 结论句的口径说明（悬停） */
  title?: string
}

/** PC-10：按行定义把信号归行——有信号为 ⚠（全是提示级为 hint），条目为「信号 计数」（口径进悬停）并带跳转目标；没有信号为 ✓ 或 — */
export function rowsFromNotices(notices: readonly PanelNotice[], defs: readonly NoticeRowDef[]): CheckRow[] {
  const ordered = orderNotices([...notices])
  return defs.map(d => {
    const hits = ordered.filter(n => d.notices.includes(n.key))
    const title = d.title ? { title: d.title } : {}
    if (hits.length) {
      const items = hits.map(n => ({ text: n.text ?? `${n.label} ${n.count}`, target: n.target, hint: !!n.hint, ...(n.note ? { title: n.note } : {}) }))
      return { key: d.key, label: d.label, state: stateOf(items), text: d.text ?? hits.map(n => `${n.label} ${n.count}`).join(' · '), items, ...title }
    }
    return d.ok !== undefined
      ? { key: d.key, label: d.label, state: 'ok', text: d.ok, items: [], ...title }
      : { key: d.key, label: d.label, state: 'none', text: d.none ?? '不适用', items: [], ...title }
  })
}
