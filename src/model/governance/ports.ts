/**
 * 端口三角（K11、ADR-0022）：一个声明了接口的模块的三方——定义（它的接口）· 实现者（implements 它）· 使用者（calls / streams 它）。
 * 只看描述；给了治理报告时每一项带该关系的证实状态（K5）。
 */
import { moduleInterfaces } from '../source'
import type { ModelIndex, RelationType } from '../types'
import type { GovernanceReport, PortParty, PortTriad } from './types'

/** 使用一个端口的关系类型：编译期知道它、命令它、经它取送数据流；通知的箭头指向订阅者，不是使用 */
const USES: readonly RelationType[] = ['calls', 'streams']

/** K11：没有声明接口的模块返回 null */
export function portTriad(index: ModelIndex, report: Pick<GovernanceReport, 'relations'> | null, moduleId: string): PortTriad | null {
  const defines = moduleInterfaces(index, moduleId)
  if (!defines.length) return null
  const inside = (id: string) => !!index.pathOf.get(id)?.includes(moduleId)
  const implementers: PortParty[] = []
  const users: PortParty[] = []
  for (const r of index.relations.values()) {
    if (!inside(r.to) || inside(r.from)) continue
    const list = r.type === 'implements' ? implementers : USES.includes(r.type) ? users : undefined
    const status = report?.relations.get(r.id)?.status
    list?.push({ relation: r.id, module: r.from, type: r.type, ...(r.via ? { via: r.via } : {}), ...(status ? { status } : {}) })
  }
  return { defines, implementers, users }
}
