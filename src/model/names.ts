/**
 * 名称查询与小谓词：只按 ID 或枚举查表，不做投影与计算。属于模型层的契约（与类型、枚举一起），
 * 呈现层、命令行与模型层内部共用同一套显示名。
 */
import type { ModelIndex, RuleKind } from './types'

/** 模块、参与者或系统根的显示名 */
export function moduleName(index: ModelIndex, id: string): string {
  return id === index.rootId ? index.model.system.name : (index.modules.get(id)?.name ?? index.actors.get(id)?.name ?? id)
}

/** G20：超过阈值即超长；没有行数（不统计的文件）不算 */
export const isLong = (lines: number | undefined, maxLines: number): boolean => lines !== undefined && lines > maxLines

/** 规则种类的名称：门禁消息、命令行与页面共用 */
export const RULE_LABELS: Record<RuleKind, string> = { layer: '层规则', deps: '依赖白名单', exposes: '访问面' }
