/**
 * 名称查询与小谓词：只按 ID 或枚举查表，不做投影与计算。属于模型层的契约（与类型、枚举一起），
 * 呈现层、命令行与模型层内部共用同一套显示名。
 */
import { parseVia, type ModelIndex, type RuleKind } from './types'

/** 模块、参与者或系统根的显示名 */
export function moduleName(index: ModelIndex, id: string): string {
  return id === index.rootId ? index.model.system.name : (index.modules.get(id)?.name ?? index.actors.get(id)?.name ?? id)
}

/** G20：超过阈值即超长；没有行数（不统计的文件）不算 */
export const isLong = (lines: number | undefined, maxLines: number): boolean => lines !== undefined && lines > maxLines

/** K5b、M20：常用通道的名称（其余通道按通道名显示） */
export const CHANNEL_LABELS: Readonly<Record<string, string>> = { http: 'HTTP', hmr: 'HMR 事件', inject: '注入', router: '路由', callback: '回调' }

/**
 * K5b：机制的显示名——`port:<接口>` 为「端口 <接口名>」、`bus:<模块>` 为「总线 <模块名>」、`channel:<名>` 为通道名（常用的取中文名）；
 * 迁移期的「端口 / 总线未指明」（M20）照此标出。给了索引时接口、模块按显示名，否则按 ID。
 */
export function viaLabel(via: string, index?: ModelIndex): string {
  const v = parseVia(via)
  if (!v) return CHANNEL_LABELS[via] ?? via
  if (v.kind === 'channel') {
    const ch = v.name ?? v.target!
    const label = CHANNEL_LABELS[ch] ?? ch
    return v.contract ? `${label}（契约 ${index ? moduleName(index, v.contract) : v.contract}）` : label
  }
  if (v.kind === 'port') return v.target ? `端口 ${index?.interfaces.get(v.target)?.name ?? v.target}` : '端口（未指明）'
  return v.target ? `总线 ${index ? moduleName(index, v.target) : v.target}` : '事件总线（未指明）'
}

/** 规则种类的名称：门禁消息、命令行与页面共用 */
export const RULE_LABELS: Record<RuleKind, string> = { layer: '层规则', deps: '依赖白名单', exposes: '访问面' }

/** L24：经回调的一句说明——「<接收方> 把执行器交给 <发起方>，契约在 <契约模块>」（没写 @ 为「契约未指明」） */
export function callbackText(idx: ModelIndex, relationId: string): string {
  const r = idx.relations.get(relationId)
  if (!r) return relationId
  const contract = parseVia(r.via)?.contract
  return `经回调：${moduleName(idx, r.to)} 把执行器交给 ${moduleName(idx, r.from)}，${contract ? `契约在 ${moduleName(idx, contract)}` : '契约未指明'}（代码依赖方向与箭头相反，L24）`
}
