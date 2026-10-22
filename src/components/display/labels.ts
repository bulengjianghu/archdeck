/** 「显示」面板的名称表：静态关系显示方式（V8）、关系类型（L8、L10）、代码事实不可用的原因（K8） */
import { RELATION_TYPES, RUNTIME_RELATION_TYPES, type HeatKind } from '@/model'
import type { StaticMode } from '@/layout/stage'

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
