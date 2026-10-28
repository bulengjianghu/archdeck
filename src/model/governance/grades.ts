/**
 * 线的级别（K23，第十四轮 F9、F10，ADR-0046）：结构视角本层每条束属于哪一级——逐条的例外（L0）、环内（L2，按组呈现）、
 * 可推出（L2，传递约简）、骨架（L1），或不在约简宇宙里的其余（边界、共用件、只引类型，按 L21、O13 原规则）。
 * 例外 = 违背现行分层（声明的层写「违规」U15，算出的层写「向上」）∪ 环 ∪ 逆稳定（U17）∪ 未解释（K7）；
 * 传递约简按第十三轮 91 §2 的口径：宇宙 = 本层两端都是内部节点、档为交互使用或值使用、不是例外也不在环上的束；
 * 先求强连通分量，分量内互不约简；分量之间在缩点 DAG 上另有长度 ≥ 2 的路径即可推出；路径只经宇宙里的边。
 * 是本层全集的纯函数，与显示偏好、聚焦无关（换成命令行也要：是被描述系统的知识）。
 */
import { stronglyConnected } from './cycles'
import type { Bundle } from './types'

/** F10：逐条的例外的种类 */
export type ExceptionKind = 'violation' | 'upward' | 'against' | 'unexplained'

/** K23：线的级别（L0 例外、L1 骨架、L2 环内与可推出；其余不在约简宇宙里） */
export type LineGrade = 'exception' | 'cycle' | 'reducible' | 'skeleton' | 'other'

export interface GradeInput {
  bundles: readonly Pick<Bundle, 'id' | 'from' | 'to' | 'tier' | 'ruling' | 'againstStability' | 'unexplained'>[]
  /** 本层内部节点（不是边界节点、不是共用件）——两端都是的束才进约简宇宙 */
  inner: (node: string) => boolean
  /** Y5：本层环上的依赖（`<依赖方>-><被依赖方>`） */
  cycleEdges: ReadonlySet<string>
  /** L28：算出的层号（普通层次分层时）；结构视角据此判「向上」 */
  tier?: ReadonlyMap<string, number> | null
  /** 不判「向上」的节点（「+N」：占位块的层号只是成员的最小值，L39④） */
  noTier?: ReadonlySet<string>
}

export interface BundleGrading {
  grade: Map<string, LineGrade>
  /** 例外的束 → 它的例外种类（按 违规 ＞ 向上 ＞ 逆稳定 ＞ 未解释） */
  exceptions: Map<string, ExceptionKind[]>
  /** F9：可推出的束 → 一条替代路径上的中间节点（依赖方 → … → 被依赖方，不含两端） */
  via: Map<string, string[]>
  /** F9：依赖方节点 → 它的可推出束（「另直连 N」） */
  direct: Map<string, string[]>
  /** F10：在环上、不是逐条例外的束（按依赖方 → 被依赖方的键） */
  cycle: Set<string>
}

const key = (from: string, to: string) => `${from}->${to}`

/** F10：一条束的例外种类；「向上」= 依赖方所在的算出的层在被依赖方之下（层号更大）——依赖的方向违背所在分层 */
export function exceptionsOf(b: GradeInput['bundles'][number], input: Pick<GradeInput, 'tier' | 'noTier'>): ExceptionKind[] {
  const out: ExceptionKind[] = []
  if (b.ruling.status === 'new' || b.ruling.status === 'open') out.push('violation')
  const a = input.noTier?.has(b.from) || input.noTier?.has(b.to) ? undefined : input.tier?.get(b.from)
  const c = a === undefined ? undefined : input.tier?.get(b.to)
  if (a !== undefined && c !== undefined && a > c) out.push('upward')
  if (b.againstStability) out.push('against')
  if (b.unexplained) out.push('unexplained')
  return out
}

/**
 * L42：照画的例外——违规、向上、逆稳定在哪都照画；只是未解释的，两端都是内部节点时照画，一端是边界节点或共用件时
 * 仍按跨界折叠 / 共用件折叠计数（议：照画会多出从框外进来的长线，L30 只降不升；它照样永不约简）
 */
export function forcedExceptions(g: Pick<BundleGrading, 'exceptions'>, bundles: GradeInput['bundles'], inner: GradeInput['inner']): Set<string> {
  const out = new Set<string>()
  for (const b of bundles) {
    const ex = g.exceptions.get(b.id)
    if (ex?.length && (ex.some(k => k !== 'unexplained') || (inner(b.from) && inner(b.to)))) out.add(b.id)
  }
  return out
}

/** K23：给本层每条束定级 */
export function gradeBundles(input: GradeInput): BundleGrading {
  const grade = new Map<string, LineGrade>()
  const exceptions = new Map<string, ExceptionKind[]>()
  const cycle = new Set<string>()
  const universe: GradeInput['bundles'][number][] = []
  for (const b of input.bundles) {
    const ex = exceptionsOf(b, input)
    if (ex.length) {
      exceptions.set(b.id, ex)
      grade.set(b.id, 'exception')
    } else if (input.cycleEdges.has(key(b.from, b.to))) {
      cycle.add(b.id)
      grade.set(b.id, 'cycle')
    } else if (input.inner(b.from) && input.inner(b.to) && b.from !== b.to && b.tier !== 'type') universe.push(b)
    else grade.set(b.id, 'other')
  }
  // 宇宙上的强连通分量：分量以第一个成员为代表
  const comp = new Map<string, string>()
  for (const g of stronglyConnected(universe.map(b => [b.from, b.to] as const))) for (const m of g) comp.set(m, g[0])
  const rep = (n: string) => comp.get(n) ?? n
  const succ = new Map<string, Set<string>>()
  for (const b of universe) {
    const a = rep(b.from)
    const c = rep(b.to)
    if (a !== c) (succ.get(a) ?? succ.set(a, new Set()).get(a)!).add(c)
  }
  // 从 s 出发、不走直连边能否到 t：先走到 s 的另一个后继，再在缩点 DAG 上找 t（返回路径上的代表节点）
  const pathVia = (s: string, t: string): string[] | null => {
    for (const first of succ.get(s) ?? []) {
      if (first === t) continue
      const prev = new Map<string, string | null>([[first, null]])
      const queue = [first]
      while (queue.length) {
        const x = queue.shift()!
        if (x === t) {
          const path: string[] = []
          for (let y: string | null = prev.get(t)!; y !== null; y = prev.get(y)!) path.unshift(y)
          return path
        }
        for (const n of succ.get(x) ?? [])
          if (!prev.has(n)) {
            prev.set(n, x)
            queue.push(n)
          }
      }
    }
    return null
  }
  const via = new Map<string, string[]>()
  const direct = new Map<string, string[]>()
  for (const b of universe) {
    const a = rep(b.from)
    const c = rep(b.to)
    const p = a === c ? null : pathVia(a, c)
    if (p) {
      grade.set(b.id, 'reducible')
      via.set(b.id, p)
      direct.set(b.from, [...(direct.get(b.from) ?? []), b.id])
    } else grade.set(b.id, 'skeleton')
  }
  return { grade, exceptions, via, direct, cycle }
}
