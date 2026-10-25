/** 「显示」面板的名称表：交互关系显示方式（V8）、关系类型（L8、L10）、代码事实不可用的原因（K8）、结构视图的种类与档（ADR-0031）、共享通道（L18） */
import {
  RELATION_TYPES,
  RUNTIME_RELATION_TYPES,
  type DeclState,
  type DepForm,
  type DepTier,
  type ElementKind,
  type HeatKind,
  type StabilityBand,
  type StructureKind,
} from '@/model'
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
// ── 第八轮（ADR-0031 修订、ADR-0032）：元素级边的形态（A2、L16）、束（L21）、表面元素（K18、L20） ──

/** A2、L16：元素级边的形态，按 DEP_FORMS 的强弱次序（子类 ＞ 组装 ＞ 端口实现 ＞ 使用） */
export const DEP_FORM_LABEL: Record<DepForm, string> = { subclass: '子类', assembly: '组装', implements: '端口实现', use: '使用' }
export const DEP_FORM_HINT: Record<DepForm, string> = {
  subclass: '实线 + 空心三角，三角在基类一端',
  assembly: '实线 + 实心菱形，菱形在组装者一端',
  implements: '虚线 + 空心三角，三角在端口定义模块一端',
  use: '虚线 + 开口箭头，指向被依赖方',
}
/** 形态对应的结构边记号（图例示意与画布同一套 depStyle） */
export const FORM_KIND: Record<DepForm, StructureKind> = { subclass: 'subclass', assembly: 'assembly', implements: 'implements', use: 'dependency' }
/** L21：束的一句说明（图例与帮助同文） */
export const BUNDLE_TEXT = '一对模块之间画一条束，线宽按束内元素级边条数；形态不止一种时标 ×N 元素'
/** C2、K18：表面元素的四类 */
export const ELEMENT_KIND_LABEL: Record<ElementKind, string> = { port: '端口', operation: '操作', type: '类型', data: '数据' }
export const ELEMENT_KIND_HINT: Record<ElementKind, string> = {
  port: '声明的接口，有实现者或被经端口引用',
  operation: '函数、可调用常量、类',
  type: 'interface / type',
  data: '枚举、纯数据常量',
}
/** 图例与面板里元素的小记号（一字，按种类） */
export const ELEMENT_KIND_MARK: Record<ElementKind, string> = { port: '◐', operation: 'ƒ', type: 'T', data: '#' }
/** C1、K18：声明状态（入口导出与声明接口按名字匹配） */
export const DECL_STATE_LABEL: Record<DeclState, string> = {
  'declared-exported': '已声明且导出',
  'exported-only': '导出未声明',
  'declared-only': '声明未导出',
  declared: '已声明（导出未知）',
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
