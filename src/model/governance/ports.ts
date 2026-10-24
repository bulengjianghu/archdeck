/** 端口三角（K11 旧形态，迁移期兼容）：端口面板、端口孤立在 facts.ts（portPanel、portIssues，ADR-0029） */
import { moduleInterfaces } from '../source'
import type { ModelIndex } from '../types'
import type { GovernanceReport, PortParty, PortTriad } from './types'

/**
 * 迁移期兼容（T3 改用 facts 里的 portPanel）：旧的端口三角——定义（模块的接口）、实现者（描述的 implementedBy 与代码事实的，relation 记为 `<接口 ID>#<模块>`）、
 * 使用者（经端口 via: port:<P>，或 interface 为 P 且 to 在定义模块子树内的交互关系的发起方，去重）。
 */
export function portTriad(index: ModelIndex, report: Pick<GovernanceReport, 'relations' | 'implementers'> | null, moduleId: string): PortTriad | null {
  const defines = moduleInterfaces(index, moduleId)
  if (!defines.length) return null
  const inside = (id: string, anc: string) => !!index.pathOf.get(id)?.includes(anc)
  const implementers: PortParty[] = []
  const users: PortParty[] = []
  for (const port of defines) {
    const facts = report?.implementers.get(port)
    const list = facts ? facts.implementers.map(i => ({ module: i.module, status: i.status })) : (index.interfaces.get(port)?.implementedBy ?? []).map(m => ({ module: m, status: undefined }))
    for (const i of list) implementers.push({ relation: `${port}#${i.module}`, module: i.module, type: 'implements', ...(i.status ? { status: i.status } : {}) })
    const owner = index.interfaces.get(port)?.owner ?? moduleId
    for (const r of index.relations.values()) {
      const used = r.via === `port:${port}` || (r.interface === port && inside(r.to, owner) && !inside(r.from, owner))
      if (!used || users.some(u => u.relation === r.id)) continue
      const status = report?.relations.get(r.id)?.status
      users.push({ relation: r.id, module: r.from, type: r.type, ...(r.via ? { via: r.via } : {}), ...(status ? { status } : {}) })
    }
  }
  return { defines, implementers, users }
}
