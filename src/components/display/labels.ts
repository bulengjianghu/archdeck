/** 「显示」面板的名称表：交互关系显示方式（V8）、关系类型（L8、L10）、代码事实不可用的原因（K8）、结构视图的形态与档（ADR-0031）、共享通道（L18） */
import {
  RELATION_TYPES,
  RUNTIME_RELATION_TYPES,
  type DeclState,
  type DepForm,
  type DepTier,
  type ElementKind,
  type HeatKind,
  type Mechanism,
  type StabilityBand,
} from '@/model'
import type { StaticMode } from '@/layout/stage'
import type { ImpactQuery } from '@/state/useDeskState'

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
/** L16（ADR-0035）：依赖一律虚线（示意线本身就是虚的，不再写「虚线 +」），形态只靠端点记号 */
export const DEP_FORM_HINT: Record<DepForm, string> = {
  subclass: '空心三角，在基类一端',
  assembly: '实心菱形，在组装者一端',
  implements: '空心菱形 ◇，在端口定义一端（与端口元素同一记号）',
  use: '开口箭头，指向被依赖方',
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
/** K15c：影响面查询的分段按钮——「不看」（none，缺省）与三个方向 */
export type ImpactChoice = ImpactQuery['mode'] | 'none'
export const IMPACT_MODE_LABEL: Record<ImpactChoice, string> = { none: '不看', in: '影响面', out: '依赖面', both: '两者' }
export const IMPACT_MODE_HINT: Record<ImpactChoice, string> = {
  none: '不查询：画布只聚焦一跳（L27）',
  in: '查一次：改它会牵动谁——依赖它的模块（传入闭包）；换选中即收回',
  out: '查一次：它要谁才能工作——它依赖的模块（传出闭包）；换选中即收回',
  both: '查一次：两个方向都看；换选中即收回',
}

/**
 * L18：共享通道——交互、结构、运行三个视角同义，三处图例同文（不得各自改写）。
 * 每项：示意种类与读法。第十八轮走查起（ADR-0058）图例不再有「共享」一组：这些行按视觉通道落到各自的节里（线宽、线型在「线」，
 * 红晕、环在「规则」或「代码事实」下，选中、变淡、演化波浪线在脚注），文字仍只在这里一份；帮助的「三个视角共享」一段也读这份。
 */
export type SharedChannelKey = 'select' | 'dim' | 'violation' | 'cycle' | 'evolution' | 'width' | 'solid' | 'dashed' | 'label'
export const SHARED_CHANNELS: readonly { key: SharedChannelKey; text: string }[] = [
  { key: 'select', text: '选中：强调色窄晕' },
  { key: 'dim', text: '变淡：不在焦点内的节点与线降低不透明度' },
  { key: 'violation', text: '违规：红晕（已知的淡红晕）' },
  { key: 'cycle', text: '↻N：本层的环编号' },
  { key: 'evolution', text: '演化：热度角标、同提交的波浪线（线型的唯一例外）' },
  { key: 'width', text: '线宽 = 合了几条本图的边：1 条 / 2–4 / ≥5' },
  // ADR-0035：线型只答「行为还是依赖」，异常与修饰写在标签位（L18、L26）
  { key: 'solid', text: '实线 = 交互：谁调谁做什么' },
  { key: 'dashed', text: '虚线 = 依赖：谁导入、继承、实现、组装谁' },
  // ADR-0041：标签位至多两段——异常（警示色）在前、修饰（中性）在后；标签至多两个、其余「+k」
  {
    key: 'label',
    text: '标签位：线中点只写 ×N、异常（警示色：违规、向上、未证实……）与修饰（中性：端口、回调、总线……、混合）；至多两个标签，其余「+k」、悬停列出',
  },
]

/** L35（ADR-0041）：机制标签的说明（图例「标签」一行的悬停），次序同词表 */
export const MECHANISM_HINTS: readonly { tag: Mechanism; text: string }[] = [
  { tag: '回调', text: '经回调：发起方调用的是接收方交来的执行器，代码依赖方向与箭头相反（L24）' },
  { tag: '端口', text: '经端口：发起方只知道端口，接收方是实现者（目标端另有插座）' },
  { tag: '总线', text: '经事件总线：两端只认识总线' },
  { tag: '注入', text: '经框架注入（provide / inject、依赖注入）' },
  { tag: '跨进程', text: '跨进程：HTTP、WebSocket、postMessage、Worker、HMR……' },
  { tag: '路由', text: '经路由导航' },
  { tag: '事件', text: '经平台事件：DOM、mediaSession、…change' },
  { tag: '通道', text: '经其他通道（通道名不在固定归类表里，04 §3.4）' },
  { tag: '拉取', text: '拉取型流：接收方按需取下一项，箭头仍指数据去向' },
]

/** L26：代码事实一组的标签说明（交互视角，「代码事实」开时出现） */
export const FACT_TAG_HINT: readonly { tag: '未证实' | '违规' | '未解释' | '缺段'; text: string }[] = [
  { tag: '未证实', text: '交互关系没有代码证据；聚合边带条数（×5 · 未证实 2），总览只写计数' },
  { tag: '违规', text: '基线外的违规依赖；关系边另加红晕，叠加虚线为红色' },
  { tag: '未解释', text: '代码有依赖、描述没写交互：画成代码依赖叠加虚线' },
  { tag: '缺段', text: '选中一条交互时承载叠加在图上，缺的一段画成警示色虚线' },
]
/** 按键取共享通道的那一句（图例各节与脚注用） */
export const SHARED_TEXT = Object.fromEntries(SHARED_CHANNELS.map(c => [c.key, c.text])) as Record<SharedChannelKey, string>

// ── 第十七轮 R4（ADR-0056）：图例行的文字一处定义——图例行（Legend 各组）与悬停释义（gloss.ts，L50）同读，不另写（C1） ──

/** O12：组装叠加的两行 */
export const ASSEMBLY_LINE_TEXT = '虚线 + 实心菱形 = 组装（new / 工厂 / 注册，菱形在组装者一端，不参与布局）'
export const ASSEMBLY_ROOT_TEXT = '组装了别的模块、自身不被组装'
/** J5、F7：时间耦合的两行 */
export const COUPLE_TEXT = '波浪线 ×N = 同一提交里一起改了 N 次；不进布局，悬停或选中一端时画出（F7），清单在面板'
export const COUPLE_ISOLATED_TEXT = '深色 = 两端没有任何依赖与关系（代码事实看不见）'
/** P15、P11：回放的两种临时线 */
export const UPPER_TEXT = '经由上层关系（类型色实线，标「经上层」；本层没有它的边）'
export const UNMODELED_TEXT = '交互中未建模（红色实线，标「未建模」）'
/** L45：开关行的名称（图例行即开关） */
export const TOGGLE_LABEL = { facts: '代码事实', assembly: '组装', heat: '演化热度', coupling: '时间耦合' } as const
/** L45：开关行悬停的说明（开 / 关的效果） */
export const TOGGLE_HINT = {
  facts: '在图上叠加代码事实：关系是否被代码证实、未解释的交互、违规与环；关闭时画布角留痕计数',
  assembly: '叠加组装事实：谁 new / 工厂创建 / 注册了谁（K13），并标出组装根',
  heat: '节点右下角的热度角标（本层分三档）；口径在工具栏「显示 ▾」里选',
  coupling: '本层总是一起改的模块之间画波浪线（不进布局，悬停或选中一端时画出）',
} as const
/** U16：没有代码事实时结构视角只画的允许边 */
export const ALLOWED_TEXT = '浅虚线 = 规则允许的依赖（mayDependOn）'
