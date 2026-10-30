/**
 * 核对卡的信号与跳转（V15b、PC-7，ADR-0053）：
 * - 信号的数据结构与严重度排序（违规、环 > 未解释、未证实 > 确认过期 > 拆分信号、逆稳定、表面提示），用于同一行内条目的次序；
 * - 条目单击跳转：记录目标清单的 `data-sec`，由显示中的面板完成「折叠的清单自动展开并滚动到位」；
 * - 拆分信号的计数（与 ModuleSplit 的清单同一口径，K21）。
 * 异常清单与计数全部来自现有派生，不新算（V15b）。
 */
import { nextTick, ref, watch, type Ref } from 'vue'

/** 一个信号：label + count + 跳转目标（data-sec）。hint 为提示级（不判问题），其余为问题级 */
export interface PanelNotice {
  key: 'violations' | 'cycles' | 'levelCycles' | 'undescribed' | 'unconfirmed' | 'carrierGap' | 'upward' | 'stale' | 'split' | 'against' | 'surface'
  label: string
  count: number
  /** 目标节的 data-sec */
  target: string
  /** 引导文字（目标节名） */
  to: string
  /** 计数口径的说明（进悬停提示，审核轮 2 B1：③ 的计数与门禁 / 返工清单口径不同，避免误读） */
  note?: string
  /** 提示级（逆稳定、表面提示、拆分信号）：警示色而非危险色 */
  hint?: boolean
}

/**
 * V15b 的严重度排序：同组内按登记次序（模块环与本层环是两个独立信号，各自一行，V15b）。
 * 波 2 铺开（G11）新增的关系级与边级信号与既有组同档：缺段（承载判定，K20）与未证实同档、
 * 向上却不是控制反转（K22）属违背分层的例外、与违规同档。
 */
export const NOTICE_RANK: Record<PanelNotice['key'], number> = {
  violations: 0,
  upward: 0,
  cycles: 1,
  levelCycles: 2,
  undescribed: 3,
  unconfirmed: 4,
  carrierGap: 4,
  stale: 5,
  split: 6,
  against: 7,
  surface: 8,
}

/** 过滤零计数并按严重度排序 */
export function orderNotices(notices: PanelNotice[]): PanelNotice[] {
  return notices.filter(n => n.count > 0).sort((a, b) => NOTICE_RANK[a.key] - NOTICE_RANK[b.key] || a.label.localeCompare(b.label))
}

// ── 行单击跳转 ──

const jumpTarget = ref<string | null>(null)

/** 核对卡条目单击：记住目标清单，由当前面板的 usePanelJump 消费 */
export function jumpToSection(sec: string) {
  jumpTarget.value = sec
}

/** 面板挂载时调用：目标清单存在时先展开其中折叠的节（Section 的 fold 按钮），再滚动到位并闪一次 */
export function usePanelJump(root: Ref<HTMLElement | null>) {
  watch(jumpTarget, async sec => {
    if (!sec) return
    jumpTarget.value = null
    await nextTick()
    const el = root.value?.querySelector<HTMLElement>(`[data-sec="${sec}"]`)
    if (!el) return
    el.querySelector<HTMLElement>('.fold[aria-expanded="false"]')?.click()
    await nextTick()
    el.scrollIntoView?.({ block: 'start' })
    el.classList.remove('jump-flash')
    void el.offsetWidth
    el.classList.add('jump-flash')
  })
}

// ── 拆分信号的计数（与 ModuleSplit 的清单同一口径） ──

/** desk.facts.splitOf 的返回形状（K21①②③④⑤ 的并集） */
export type SplitShape = {
  noFiles: boolean
  shared: { file: string; modules: string[] }[]
  children: { noFiles: string[]; shared: { file: string; modules: string[] }[] }
  noDeps: boolean
  undepended: { from: string; to: string }[]
}

/** 拆分信号的条数：不占文件、共用文件、子模块不占文件 / 共用文件、交互没有值依赖、超长文件（G20）各算一条 */
export function splitSignalCount(s: SplitShape | null, longFiles: number): number {
  if (!s) return 0
  return (
    (s.noFiles ? 1 : 0) +
    s.shared.length +
    s.children.noFiles.length +
    s.children.shared.length +
    (s.noDeps ? 1 : 0) +
    (s.noDeps ? 0 : s.undepended.length) +
    (longFiles > 0 ? 1 : 0)
  )
}
