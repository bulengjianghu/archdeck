/**
 * 名称查询与小谓词：只按 ID 或枚举查表，不做投影与计算。属于模型层的契约（与类型、枚举一起），
 * 呈现层、命令行与模型层内部共用同一套显示名。
 */
import { isUnclassified, parseVia, type ModelIndex, type RelationEntity, type RuleKind } from './types'

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
  if (v.kind === 'channel') return CHANNEL_LABELS[v.target!] ?? v.target!
  if (v.kind === 'port') return v.target ? `端口 ${index?.interfaces.get(v.target)?.name ?? v.target}` : '端口（未指明）'
  return v.target ? `总线 ${index ? moduleName(index, v.target) : v.target}` : '事件总线（未指明）'
}

/** 迁移期兼容：呈现层按 `VIA_LABELS[via]` 取名（T3 改用 viaLabel） */
export const VIA_LABELS: Readonly<Record<string, string>> = new Proxy({} as Record<string, string>, {
  get: (_, key) => (typeof key === 'string' ? viaLabel(key) : undefined),
})

/** 规则种类的名称：门禁消息、命令行与页面共用 */
export const RULE_LABELS: Record<RuleKind, string> = { layer: '层规则', deps: '依赖白名单', exposes: '访问面' }

// ── 四类交互（ADR-0029）：未分类关系与「核心之间」（M17） ──

/** M17：模块自身及祖先中的核心模块（role: core）；参与者与没有核心祖先的模块为空 */
export function coresOf(index: ModelIndex, id: string): string[] {
  return (index.pathOf.get(id) ?? []).filter(p => index.modules.get(p)?.role === 'core')
}

/**
 * M17（T0 裁决 12）：核心之间——两端各自是核心模块或在核心模块的子树内，且没有一个核心模块的子树同时包含两端。
 * 架构师只确认这些线的分类（写进草图即确认，X23）。
 */
export function isCoreBetween(index: ModelIndex, r: Pick<RelationEntity, 'from' | 'to'>): boolean {
  const a = coresOf(index, r.from)
  const b = coresOf(index, r.to)
  return a.length > 0 && b.length > 0 && !a.some(x => b.includes(x))
}

/** M17：未分类（calls）的关系与其中核心之间的，按声明顺序 */
export function unclassifiedRelations(index: ModelIndex): { all: RelationEntity[]; core: RelationEntity[] } {
  const all = [...index.relations.values()].filter(r => isUnclassified(r.type)).sort((a, b) => a.seq - b.seq)
  return { all, core: all.filter(r => isCoreBetween(index, r)) }
}
