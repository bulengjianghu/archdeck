import type { FragmentTag, PlanNode, ScenarioPlan, Choices, FrameStatus, OutlineOption, OutlineNode } from './types'
/**
 * 步骤大纲（T6）：把回放计划按组合结构还原成一棵树，供导航树的步骤树逐行画出。
 * 与层次无关，只随计划与已选分支变化；状态与时序图全貌一致（linearize 的 display 模式）：
 * 路径上为 path，未选的选项为 unchosen，截止处之后为 unreached。
 */

const sameTag = (a: FragmentTag, b: FragmentTag) => a.id === b.id && a.branch === b.branch

export function outlineScenario(plan: ScenarioPlan, choices: Choices): OutlineNode[] {
  let reached = true

  /** depth：nodes 所在的组合框深度（外层标签数）；status：外层给定的状态 */
  const build = (nodes: readonly PlanNode[], depth: number, status: FrameStatus): OutlineNode[] => {
    // 先按书写顺序生成每个计划节点对应的树节点，并记下它在 depth 处的组合框标签
    const items: { tags: readonly FragmentTag[]; node: OutlineNode }[] = []
    for (const n of nodes) {
      const st: FrameStatus = status === 'path' && !reached ? 'unreached' : status
      if (n.kind === 'frame') {
        items.push({ tags: n.frame.fragments, node: { kind: 'frame', frame: n.frame, status: st } })
        continue
      }
      const c = choices.get(n.point.id)
      const valid = c !== undefined && c >= 0 && c < n.options.length
      if (st === 'path' && !valid) reached = false
      const options = n.options.map((opt, k): OutlineOption => {
        const os: FrameStatus = st !== 'path' ? st : !valid ? 'unreached' : k === c ? 'path' : 'unchosen'
        return { option: k, when: n.point.options[k].when, status: os, children: build(opt, n.point.fragments.length + 1, os) }
      })
      // 选中的分支走完后，路径在其后继续；未选分支（含 unreached）不影响 reached
      items.push({ tags: n.point.fragments, node: { kind: 'alt', pointId: n.point.id, options } })
    }
    return group(items, depth)
  }

  /** 连续带同一组合框标签（depth 处）的条目归入同一个分组 */
  const group = (items: { tags: readonly FragmentTag[]; node: OutlineNode }[], depth: number): OutlineNode[] => {
    const out: OutlineNode[] = []
    let k = 0
    while (k < items.length) {
      const tag = items[k].tags[depth]
      if (!tag) {
        out.push(items[k++].node)
        continue
      }
      const run: typeof items = []
      while (k < items.length && items[k].tags[depth] && sameTag(items[k].tags[depth], tag)) run.push(items[k++])
      out.push({ kind: 'group', tag, children: group(run, depth + 1) })
    }
    return out
  }

  return build(plan.nodes, 0, 'path')
}
