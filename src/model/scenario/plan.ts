/**
 * 回放计划（F1–F6）：把步骤树展开成帧树，只在 alt 处分叉为分支点。与层次无关，打开场景时算一次。
 * - 消息步骤 = 一帧（F1）；组合步骤只给帧打标签（fragments，外到内）；
 * - 帧 ID = 场景 ID + `#` + 步骤 id，没写时用步骤路径；ref 内联时加上引用处前缀 `<ref 路径>/`（F2、F3）；
 * - loop 展开一遍（F4）；par 各分支按书写顺序串行（F5）；alt 每个选项一棵子树（F6）；
 * - 每帧绑定对应的结构关系（bindRelation，S12、S13）；步骤没写的接口与数据取自对应关系（S14）。
 */
import type { ModelIndex, Step } from '../types'
import { bindRelation } from './bind'
import type { FragmentTag, Frame, BranchPoint, PlanNode, ScenarioPlan, ReturnPairs } from './types'

export function planScenario(index: ModelIndex, scenarioId: string): ScenarioPlan {
  const frames = new Map<string, Frame>()
  const points = new Map<string, BranchPoint>()

  const expand = (steps: readonly Step[], ctx: { writtenIn: string; prefix: string; fragments: FragmentTag[]; stack: string[] }): PlanNode[] => {
    const out: PlanNode[] = []
    const instanceId = (path: string) => `${scenarioId}#${ctx.prefix}${path}`
    for (const s of steps) {
      switch (s.kind) {
        case 'call':
        case 'async':
        case 'return': {
          const b = bindRelation(index, { kind: s.kind, from: s.msg.from, to: s.msg.to, relation: s.msg.relation })
          // S14：没写的接口与数据取自对应关系；返回只取接口（关系上的数据描述的是调用方向）
          const rel = b.issue || !b.relation ? undefined : index.relations.get(b.relation)
          const inheritIf = !s.msg.interface && !!rel?.interface
          const inheritData = s.kind !== 'return' && s.msg.payload.length === 0 && !!rel?.payload?.length
          const frame: Frame = {
            id: `${scenarioId}#${ctx.prefix}${s.msg.id ?? s.path}`,
            kind: s.kind,
            from: s.msg.from,
            to: s.msg.to,
            label: s.msg.label,
            interface: s.msg.interface ?? (inheritIf ? rel!.interface : undefined),
            payload: inheritData ? [...rel!.payload!] : s.msg.payload,
            note: s.msg.note,
            relation: b.issue ? undefined : b.relation,
            relationInferred: b.inferred,
            reverse: b.reverse,
            ...(inheritIf || inheritData ? { inherited: { ...(inheritIf ? { interface: true } : {}), ...(inheritData ? { payload: true } : {}) } } : {}),
            scenarioId: ctx.writtenIn,
            stepPath: s.path,
            src: s.src,
            fragments: ctx.fragments,
          }
          frames.set(frame.id, frame)
          out.push({ kind: 'frame', frame })
          break
        }
        case 'loop':
          out.push(...expand(s.steps, { ...ctx, fragments: [...ctx.fragments, { kind: 'loop', id: instanceId(s.path), label: s.while }] }))
          break
        case 'par':
          s.branches.forEach((b, k) => {
            out.push(...expand(b.steps, { ...ctx, fragments: [...ctx.fragments, { kind: 'par', id: instanceId(s.path), label: '并行', branch: k }] }))
          })
          break
        case 'ref': {
          const target = index.scenarios.get(s.scenario)
          // 校验已保证 ref 存在且无环（S6），这里只做防御
          if (!target || ctx.stack.includes(target.id)) break
          out.push(
            ...expand(target.steps, {
              writtenIn: target.id,
              prefix: `${ctx.prefix}${s.path}/`,
              fragments: [...ctx.fragments, { kind: 'ref', id: instanceId(s.path), label: target.name }],
              stack: [...ctx.stack, target.id],
            }),
          )
          break
        }
        case 'alt': {
          const id = instanceId(s.path)
          const options = s.branches.map((b, k) => expand(b.steps, { ...ctx, fragments: [...ctx.fragments, { kind: 'alt', id, label: b.when, branch: k }] }))
          const point: BranchPoint = { id, fragments: ctx.fragments, options: s.branches.map((b, k) => ({ when: b.when, first: firstFrame(options[k]) })) }
          points.set(id, point)
          out.push({ kind: 'branch', point, options })
          break
        }
      }
    }
    return out
  }

  const sc = index.scenarios.get(scenarioId)
  const nodes = sc ? expand(sc.steps, { writtenIn: scenarioId, prefix: '', fragments: [], stack: [scenarioId] }) : []
  return { scenarioId, nodes, frames, points }
}

/** 一棵子树中按书写顺序的第一帧（遇到分支点时依次看各选项） */
export function firstFrame(nodes: readonly PlanNode[]): Frame | undefined {
  for (const n of nodes) {
    if (n.kind === 'frame') return n.frame
    for (const opt of n.options) {
      const f = firstFrame(opt)
      if (f) return f
    }
  }
  return undefined
}

/**
 * F7：调用与显式返回配对。按书写顺序以栈匹配：call 入栈；return（X → Y）匹配栈中最近的 Y → X 调用，
 * 并弹出它及其上的调用（它们没有显式返回）。alt 的每个选项从进入分支点时的栈副本开始，选项内未配对的调用随选项结束丢弃，
 * 分支点之后继续用进入时的栈；async 不配对。与层次、已选分支无关。
 */
export function pairReturns(plan: ScenarioPlan): ReturnPairs {
  const pairs = new Map<string, string>()
  const walk = (nodes: readonly PlanNode[], stack: Frame[]) => {
    for (const n of nodes) {
      if (n.kind === 'branch') {
        for (const opt of n.options) walk(opt, [...stack])
        continue
      }
      const f = n.frame
      if (f.kind === 'call') stack.push(f)
      else if (f.kind === 'return') {
        let i = stack.length - 1
        while (i >= 0 && !(stack[i].from === f.to && stack[i].to === f.from)) i--
        if (i < 0) continue
        if (!pairs.has(stack[i].id)) pairs.set(stack[i].id, f.id)
        pairs.set(f.id, stack[i].id)
        stack.length = i
      }
    }
  }
  walk(plan.nodes, [])
  return pairs
}
