/**
 * 端口（ADR-0029）：端口面板（K11，原端口三角）与端口孤立（U14）。端口就是接口：归属定义模块（owner），实现者来自描述的 implementedBy
 * 与代码事实（K5c，「仅代码事实」的实现者，见 facts.ts confirmImplementers），使用者是经端口（via: port:<P>）或直接（interface 为 P）的交互关系的发起方。
 * 给了治理报告时实现者带证据档、使用者带证实状态；没有代码事实（设计版本，K8）时只按描述。
 */
import { moduleName } from '../names'
import { parseVia, type Issue, type ModelIndex } from '../types'
import { moduleInterfaces } from '../source'
import { isTarget, portOwner, related } from './facts'
import type { GovernanceReport, PortImplementer, PortPanel, PortUser } from './types'

type ReportPart = Pick<GovernanceReport, 'relations' | 'implementers'> | null

/** K11：一个接口的端口面板（定义 · 实现者 · 使用者）；isPort 为裁决 4 的「算端口」——被 via: port: 引用、或有实现者（描述或代码事实） */
export function portEntry(index: ModelIndex, report: ReportPart, portId: string): PortPanel | null {
  const x = index.interfaces.get(portId)
  if (!x) return null
  const owner = portOwner(index, portId)
  const facts = report?.implementers.get(portId)
  const implementers: PortImplementer[] = facts
    ? facts.implementers.map(i => ({
        module: i.module,
        described: i.described,
        code: i.code,
        status: i.status,
        ...(i.structural ? { structural: true as const } : {}),
        ...(i.likeDepends ? { likeDepends: true as const } : {}),
      }))
    : (x.implementedBy ?? []).map(m => ({ module: m, described: true, code: false }))
  const users: PortUser[] = []
  for (const r of index.relations.values()) {
    const v = parseVia(r.via)
    const how = v?.kind === 'port' && v.target === portId ? 'port' : r.interface === portId && owner && related(index, r.to, owner) && !related(index, r.from, owner) ? 'direct' : undefined
    if (!how) continue
    const status = report?.relations.get(r.id)?.status
    users.push({ relation: r.id, module: r.from, type: r.type, how, ...(status ? { status } : {}) })
  }
  const isPort = !!x.port || implementers.length > 0 || users.some(u => u.how === 'port')
  return { port: portId, ...(owner ? { owner } : {}), isPort, implementers, users }
}

/** K11：模块的端口一节——它声明的每个接口（子树内 owner 指向它的接口与 provides，G12）各一份端口面板；没有声明接口为空 */
export function portPanel(index: ModelIndex, report: ReportPart, moduleId: string): PortPanel[] {
  return moduleInterfaces(index, moduleId).flatMap(id => {
    const p = portEntry(index, report, id)
    return p ? [p] : []
  })
}

/**
 * U14：端口孤立——端口（裁决 4）没有任何实现者（描述与「仅代码事实」都没有）→ warning `port.no-implementer`；有实现者而没有任何使用者 → info `port.no-user`
 * （T0 裁决 11）。一个端口一条；定义模块或全部实现者是目标态的不报。没有代码事实时只按描述（设计版本，K8）。
 */
export function portIssues(index: ModelIndex, report: ReportPart): Issue[] {
  const out: Issue[] = []
  const name = (id: string) => moduleName(index, id)
  for (const x of index.interfaces.values()) {
    const p = portEntry(index, report, x.id)
    if (!p?.isPort) continue
    if ((p.owner && isTarget(index, p.owner)) || (p.implementers.length && p.implementers.every(i => isTarget(index, i.module)))) continue
    const where = `端口「${x.name}」（${x.id}${p.owner ? `，定义于 ${name(p.owner)}` : ''}）`
    if (!p.implementers.length)
      out.push({ severity: 'warning', code: 'port.no-implementer', message: `${where}没有任何实现者（描述与代码事实都没有）：补实现者、删去 via: port:，或确认端口是否多余（U14）`, ...x.src })
    else if (!p.users.length)
      out.push({ severity: 'info', code: 'port.no-user', message: `${where}有 ${p.implementers.length} 个实现者，系统内没有任何使用者：对外端口时是常态，否则确认端口是否多余（U14）`, ...x.src })
  }
  return out
}
