/** 「显示」面板的名称表：交互关系显示方式（V8）、关系类型（L8、L10）、代码事实不可用的原因（K8）、结构视图的形态与档（ADR-0031）、共享通道（L18） */
import {
  RELATION_TYPES,
  RUNTIME_RELATION_TYPES,
  type DeclState,
  type DepForm,
  type DepTier,
  type ElementKind,
  type HeatKind,
  type StabilityBand,
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

// ── 结构视图（ADR-0031）：依赖的档（K14、L16）、不稳定度三档（K16、L17）、影响面方向（K15） ──

export const DEP_TIER_LABEL: Record<DepTier, string> = { invokes: '交互使用', value: '值使用', type: '只引类型' }
export const DEP_TIER_HINT: Record<DepTier, string> = {
  invokes: '深：调用了对方的函数或方法',
  value: '中：只读对方的常量、枚举等值',
  type: '浅：只引了类型，缺省收起',
}
// ── 第八轮（ADR-0031 修订、ADR-0032）：元素级边的形态（A2、L16）、束（L21）、表面元素（K18、L20） ──

/** A2、L16：元素级边的形态，按 DEP_FORMS 的强弱次序（子类 ＞ 组装 ＞ 端口实现 ＞ 使用） */
export const DEP_FORM_LABEL: Record<DepForm, string> = { subclass: '子类', assembly: '组装', implements: '端口实现', use: '使用' }
/** L16（ADR-0035）：依赖一律虚线，形态只靠端点记号 */
export const DEP_FORM_HINT: Record<DepForm, string> = {
  subclass: '虚线 + 空心三角，三角在基类一端',
  assembly: '虚线 + 实心菱形，菱形在组装者一端',
  implements: '虚线 + 空心菱形 ◇，◇ 在端口定义模块一端（与端口元素同一记号）',
  use: '虚线 + 开口箭头，指向被依赖方',
}
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
/** 图例与面板里元素的小记号（一字，按种类；与画布元素记号 SurfaceMarks 同一套：端口 ◇、操作 ●、类型 ○、数据 ■） */
export const ELEMENT_KIND_MARK: Record<ElementKind, string> = { port: '◇', operation: '●', type: '○', data: '■' }
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
export const SHARED_CHANNELS: readonly {
  key: 'select' | 'dim' | 'violation' | 'cycle' | 'evolution' | 'width' | 'solid' | 'dashed' | 'label'
  text: string
}[] = [
  { key: 'select', text: '选中：强调色窄晕' },
  { key: 'dim', text: '变淡：不在焦点内的节点与线降低不透明度' },
  { key: 'violation', text: '违规：红晕（已知的淡红晕）' },
  { key: 'cycle', text: '↻N：本层的环编号' },
  { key: 'evolution', text: '演化：热度角标、同提交的波浪线（线型的唯一例外）' },
  { key: 'width', text: '线宽 = 合了几条本图的边：1 条 / 2–4 / ≥5' },
  // ADR-0035：线型只答「行为还是依赖」，异常与修饰写在标签位（L18、L26）
  { key: 'solid', text: '实线 = 交互：谁调谁做什么' },
  { key: 'dashed', text: '虚线 = 依赖：谁导入、继承、实现、组装谁' },
  { key: 'label', text: '标签位：线中点只写 ×N 与异常、修饰（未证实、违规、回调……）' },
]

/** L26：代码事实一组的标签说明（交互视角，「代码事实」开时出现） */
export const FACT_TAG_HINT: readonly { tag: '未证实' | '违规' | '未解释' | '缺段'; text: string }[] = [
  { tag: '未证实', text: '交互关系没有代码证据；聚合边带条数（×5 · 未证实 2），总览只写计数' },
  { tag: '违规', text: '基线外的违规依赖；关系边另加红晕，叠加虚线为红色' },
  { tag: '未解释', text: '代码有依赖、描述没写交互：画成代码依赖叠加虚线' },
  { tag: '缺段', text: '选中一条交互时承载叠加在图上，缺的一段画成警示色虚线' },
]
export const SHARED_CHANNELS_TITLE = '共享 · 三个视角同义'
