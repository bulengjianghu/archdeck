/**
 * 参与查询（V6）：某个模块 / 关系 / 视图边 / 参与者在本场景中做了什么。
 * 脱离工作台同样成立，例如问「Layout 在打开场景这个流程里做了什么」用的是同一个查询。
 */
import type { ModelIndex } from '../types'
import type { Frame, ScenarioPlan, ScenarioLevelView, ParticipationTarget, Participation } from './types'
import { bindRelation } from './semantics/bind'
import { forEachStep } from './semantics/steps'

export function participation(
  index: ModelIndex,
  frames: readonly Frame[],
  view: ScenarioLevelView,
  target: ParticipationTarget,
  playhead?: string | null,
): Participation {
  const inside = (id: string) => (target.kind === 'actor' ? id === target.id : (index.pathOf.get(id)?.includes(target.id) ?? false))
  const edgeOf = (f: Frame) => {
    const m = view.messageOf.get(f.id)
    const at = m === undefined ? undefined : view.messages[m].at
    return at?.kind === 'edge' ? at.edgeId : undefined
  }

  const out: Participation['frames'] = []
  frames.forEach((f, seq) => {
    if (target.kind === 'relation') {
      if (f.relation === target.id) out.push({ frameId: f.id, seq, role: 'traverse' })
    } else if (target.kind === 'edge') {
      if (edgeOf(f) === target.id) out.push({ frameId: f.id, seq, role: 'traverse' })
    } else {
      const a = inside(f.from)
      const b = inside(f.to)
      if (a || b) out.push({ frameId: f.id, seq, role: a && b ? 'internal' : a ? 'from' : 'to' })
    }
  })

  const byId = new Map(frames.map(f => [f.id, f]))
  const involved = out.map(p => byId.get(p.frameId)!)
  const uniq = <T,>(xs: T[]) => [...new Set(xs)]
  const messages = uniq(out.map(p => view.messageOf.get(p.frameId)).filter((m): m is number => m !== undefined))

  let nearest: string | undefined
  if (playhead && out.length) {
    const at = frames.findIndex(f => f.id === playhead)
    nearest = out.reduce((best, p) => (Math.abs(p.seq - at) < Math.abs(best.seq - at) ? p : best)).frameId
  }

  return {
    frames: out,
    messages,
    interfaces: uniq(involved.map(f => f.interface).filter((x): x is string => !!x)),
    dataStructures: uniq(involved.flatMap(f => f.payload)),
    nearest,
  }
}

/** T5：参与本场景的模块——计划中全部帧（含所有分支）的模块端点及其祖先（不含系统根）；与层次、播放头无关 */
export function scenarioModules(index: ModelIndex, plan: ScenarioPlan): Set<string> {
  const out = new Set<string>()
  for (const f of plan.frames.values())
    for (const id of [f.from, f.to]) for (const m of index.pathOf.get(id) ?? []) if (m !== index.rootId) out.add(m)
  return out
}

/** PC-10：经过这条关系的场景——有消息步骤绑定到它（显式写 relation 或按两端推出，S 系列的绑定口径），按场景声明次序 */
export function relationScenarios(index: ModelIndex, relationId: string): string[] {
  const out: string[] = []
  for (const sc of index.scenarios.values()) {
    let hit = false
    forEachStep(sc.steps, s => {
      if (!hit && 'msg' in s && bindRelation(index, { kind: s.kind, ...s.msg }).relation === relationId) hit = true
    })
    if (hit) out.push(sc.id)
  }
  return out
}
