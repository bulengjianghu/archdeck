/** 「显示」面板的名称表：交互关系显示方式（V8）、关系类型（L8、L10）、代码事实不可用的原因（K8）、结构视图的种类与档（ADR-0031）、共享通道（L18） */
import { RELATION_TYPES, RUNTIME_RELATION_TYPES, type DepTier, type HeatKind, type StabilityBand, type StructureKind } from '@/model'
import type { StaticMode } from '@/layout/stage'
import type { ImpactMode } from './useDisplayPrefs'

export const MODES: readonly StaticMode[] = ['hide', 'dim', 'show']
export const MODE_LABEL: Record<StaticMode, string> = { hide: '隐藏', dim: '淡显', show: '全显' }
export const MODE_HINT: Record<StaticMode, string> = {
  hide: '只显示参与本场景的节点与走过的边',
  dim: '不参与的节点与静态边淡化显示',
  show: '全部照常显示',
}

export { RELATION_TYPE_LABELS as TYPE_LABEL, RELATION_TYPE_HINTS as TYPE_HINT } from '../shared/labels'
/** 与画布一致（L10）：运行时在前 */
export const TYPE_ORDER = [...RUNTIME_RELATION_TYPES, ...RELATION_TYPES.filter(t => !RUNTIME_RELATION_TYPES.includes(t))]

/** J5：热度种类 */
export const HEAT_LABEL: Record<'off' | HeatKind, string> = { off: '关', changes: '修改', fixes: '缺陷' }
export const HEAT_HINT: Record<'off' | HeatKind, string> = {
  off: '不显示热度角标',
  changes: '修改热度 = 修改次数 × √当前行数（窗口内）',
  fixes: '缺陷热度 = 缺陷修复提交数 × √当前行数（窗口内）',
}

export const EVOLUTION_HINT: Record<string, string> = {
  design: '设计版本与历史提交不对应当前代码，没有演化事实',
  loading: '正在读取 git 历史…',
  error: '读不到 git 历史',
}

export const FACTS_HINT: Record<string, string> = {
  design: '设计版本与历史提交不对应当前代码，没有代码事实',
  loading: '正在提取代码依赖…',
  error: '读取源码或提取代码依赖失败',
}

// ── 结构视图（ADR-0031）：结构边的种类与档（K14、L16）、不稳定度三档（K16、L17）、影响面方向（K15） ──

export const STRUCTURE_KIND_LABEL: Record<StructureKind, string> = { dependency: '依赖', assembly: '组装', subclass: '子类', implements: '端口实现' }
export const STRUCTURE_KIND_HINT: Record<StructureKind, string> = {
  dependency: '虚线 + 开口箭头，指向被依赖方',
  subclass: '继承：实线 + 空心三角，三角在基类一端',
  implements: '虚线 + 空心三角，三角在端口定义模块一端',
  assembly: '实线 + 实心菱形，菱形在组装者一端',
}
export const DEP_TIER_LABEL: Record<DepTier, string> = { invokes: '交互使用', value: '值使用', type: '只引类型' }
export const DEP_TIER_HINT: Record<DepTier, string> = {
  invokes: '深：调用了对方的函数或方法',
  value: '中：只读对方的常量、枚举等值',
  type: '浅：只引了类型，缺省收起',
}
export const STABILITY_LABEL: Record<StabilityBand, string> = { stable: '稳定', balanced: '居中', unstable: '易变' }
export const IMPACT_MODE_LABEL: Record<ImpactMode, string> = { in: '影响面', out: '依赖面', both: '两者' }
export const IMPACT_MODE_HINT: Record<ImpactMode, string> = {
  in: '改它会牵动谁：依赖它的模块（传入闭包）',
  out: '它要谁才能工作：它依赖的模块（传出闭包）',
  both: '两个方向都看',
}

/**
 * L18：共享通道——交互、结构、运行三个视角同义，三处图例同文（不得各自改写）。
 * 每项：示意种类与读法。
 */
export const SHARED_CHANNELS: readonly { key: 'select' | 'dim' | 'violation' | 'cycle' | 'evolution' | 'width'; text: string }[] = [
  { key: 'select', text: '选中：强调色窄晕' },
  { key: 'dim', text: '变淡：不在焦点内的节点与线降低不透明度' },
  { key: 'violation', text: '违规：红晕（已知的淡红晕）' },
  { key: 'cycle', text: '↻N：本层的环编号' },
  { key: 'evolution', text: '演化：热度角标、同提交的波浪线' },
  { key: 'width', text: '线宽 = 合了几条本图的边：1 条 / 2–4 / ≥5' },
]
export const SHARED_CHANNELS_TITLE = '共享 · 三个视角同义'
