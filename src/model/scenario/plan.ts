/**
 * 回放计划（F1–F6）：把步骤树展开成帧树，只在 alt 处分叉为分支点。与层次无关，打开场景时算一次。
 * - 消息步骤 = 一帧（F1）；组合步骤只给帧打标签（fragments，外到内）；
 * - 帧 ID = 场景 ID + `#` + 步骤 id，没写时用步骤路径；ref 内联时加上引用处前缀 `<ref 路径>/`（F2、F3）；
 * - loop 展开一遍（F4）；par 各分支按书写顺序串行（F5）；alt 每个选项一棵子树（F6）；
 * - 每帧绑定对应的结构关系（bindRelation，S12、S13）。
 */
import type { MessageKind, ModelIndex, SourceLoc, Step } from '../types'
import { bindRelation } from './bind'

export type FragmentKind = 'alt' | 'loop' | 'par' | 'ref'

/** 帧所在的一层组合框：id 是组合框实例 ID（alt 即分支点 ID），branch 是所在分支 */
export interface FragmentTag {
  kind: FragmentKind
  id: string
  label: string
  branch?: number
}

export interface Frame {
  id: string
  kind: MessageKind
  /** 真实端点：最深模块或参与者 */
  from: string
  to: string
  label?: string
  interface?: string
  payload: string[]
  note?: string
  relation?: string
  /** S13：对应关系是推断的 */
  relationInferred: boolean
  /** 消息方向与关系箭头相反 */
  reverse: boolean
  /** 步骤写在哪个场景（ref 内联时为被引用的场景）及其路径、出处 */
  scenarioId: string
  stepPath: string
  src: SourceLoc
  /** 外到内 */
  fragments: FragmentTag[]
}

export interface BranchPoint {
  id: string
  /** 分支点所在的组合框（不含它自己的 alt 标签） */
  fragments: FragmentTag[]
  options: { when: string; first?: Frame }[]
}

export type PlanNode = { kind: 'frame'; frame: Frame } | { kind: 'branch'; point: BranchPoint; options: PlanNode[][] }

export interface ScenarioPlan {
  scenarioId: string
  nodes: PlanNode[]
  /** 计划中的全部帧（含所有分支），按书写顺序 */
  frames: Map<string, Frame>
  points: Map<string, BranchPoint>
}

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
          const frame: Frame = {
            id: `${scenarioId}#${ctx.prefix}${s.msg.id ?? s.path}`,
            kind: s.kind,
            from: s.msg.from,
            to: s.msg.to,
            label: s.msg.label,
            interface: s.msg.interface,
            payload: s.msg.payload,
            note: s.msg.note,
            relation: b.issue ? undefined : b.relation,
            relationInferred: b.inferred,
            reverse: b.reverse,
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
