/** 步骤树的遍历：按书写顺序访问消息步骤，ref 进入被引用的场景（遇到循环引用即停）。 */
import type { MessageStep, ScenarioEntity, Step } from '../types'

export function forEachStep(steps: readonly Step[], visit: (s: Step) => void): void {
  for (const s of steps) {
    visit(s)
    if (s.kind === 'alt' || s.kind === 'par') for (const b of s.branches) forEachStep(b.steps, visit)
    else if (s.kind === 'loop') forEachStep(s.steps, visit)
  }
}

/** 场景（含 ref 内联的子场景）中全部的消息步骤，按书写顺序 */
export function messagesOf(scenarios: ReadonlyMap<string, ScenarioEntity>, scenarioId: string): MessageStep[] {
  const out: MessageStep[] = []
  const walk = (id: string, stack: string[]) => {
    const sc = scenarios.get(id)
    if (!sc || stack.includes(id)) return
    forEachStep(sc.steps, s => {
      if ('msg' in s) out.push(s)
      else if (s.kind === 'ref') walk(s.scenario, [...stack, id])
    })
  }
  walk(scenarioId, [])
  return out
}

/** 对组合步骤的每个子列表应用 f，其余步骤原样返回 */
export function mapChildren(s: Step, f: (steps: Step[]) => Step[]): Step {
  switch (s.kind) {
    case 'alt':
      return { ...s, branches: s.branches.map(b => ({ ...b, steps: f(b.steps) })) }
    case 'par':
      return { ...s, branches: s.branches.map(b => ({ ...b, steps: f(b.steps) })) }
    case 'loop':
      return { ...s, steps: f(s.steps) }
    default:
      return s
  }
}
