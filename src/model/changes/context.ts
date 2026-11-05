/**
 * DL-14（波 2）：草图里的上下文——页面从编辑会话构造，开发服务器原样放进上下文包（类型 SketchContext 在 dialogue/contextPack.ts）。
 * 放在改动项这里而不在对话的模型里：它要读草图集合与基线的挂载点范围（意图），而对话的模型挂在确认层下、只许依赖类型契约（rules.yaml）。
 */
import type { SketchContext } from '../dialogue/contextPack'
import { mountScope } from '../intent/scope'
import type { SketchSet } from '../intent/types'
import { ROOT_MOUNT, type ModelIndex, type SketchDef } from '../types'

/**
 * 草图里的上下文（页面从编辑会话构造）——当前张全文、其他草图的模块名单、基线里同一层（挂载点的直接子模块与本层关系）、
 * 带号的改动清单、父模块的原则（草图里写了的优先，否则取当前版本）。
 */
export function buildSketchContext(input: {
  design: string
  mount: string
  sketches: SketchSet
  baseline: ModelIndex | null
  current: ModelIndex | null
  changes: readonly { n: number; kind: string; summary: string; round: number; by: string }[]
}): SketchContext {
  const { sketches, mount, baseline } = input
  const def = sketches[mount]
  const flat = (d: SketchDef): { id: string; name: string }[] => {
    const out: { id: string; name: string }[] = []
    const walk = (list: NonNullable<SketchDef['modules']>) => list.forEach(m => (out.push({ id: m.id, name: m.name }), walk(m.children ?? [])))
    walk(d.modules ?? [])
    return out
  }
  const scope = baseline && (mount === ROOT_MOUNT || baseline.modules.has(mount)) ? mountScope(baseline, mount) : null
  const principle = def?.abstraction?.trim() || (mount !== ROOT_MOUNT ? input.current?.modules.get(mount)?.abstraction?.trim() : '') || null
  return {
    design: input.design,
    mount,
    current: def ?? { id: input.design, mount, modules: [] },
    others: Object.entries(sketches)
      .filter(([m]) => m !== mount)
      .map(([m, d]) => ({ mount: m, modules: flat(d) })),
    baseline: {
      modules: (scope?.modules ?? []).map(id => {
        const m = baseline!.modules.get(id)!
        return { id, name: m.name, ...(m.kind ? { kind: m.kind } : {}) }
      }),
      relations: (scope?.relations ?? []).map(id => {
        const r = baseline!.relations.get(id)!
        return { id, from: r.from, to: r.to, type: r.type }
      }),
    },
    changes: input.changes.map(c => ({ n: c.n, kind: c.kind, summary: c.summary, round: c.round, by: c.by })),
    principle,
  }
}
