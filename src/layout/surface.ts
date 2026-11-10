/**
 * 表面展开的输入（C6、L20②、L23；ADR-0032）：按选中与显示偏好「总是展开表面」定哪些节点展开、每个展开节点的元素端口与散开范围，
 * 交给布局（StructureLinks.expand / interactions）。纯函数，两个视角同一套规则——布局按并集（结构视角的元素级边接到的元素 ∪ 交互束接到的元素），
 * 切换视角时展开的节点与元素不变（V12），各视角只画自己的边与元素记号。
 *   触发：选中模块 → 展开它（全部依赖方 / 发起方）；选中交互或视图边 → 展开接收方，只散开发起方那一侧；「总是展开表面」→ 本层全部模块。
 *   选中束（`sel=d:A->B`）不展开（T2-7 裁决：只聚焦与高亮，元素在面板看），免得单击一条线引起本层重排。只对普通层次的内部模块（不含共用件、边界节点、边界角色、参与者、「+N」）；分层总览不展开。
 *   元素端口：本层（散开范围内）有元素级边接到的元素与交互接到的元素，按种类（端口、操作、类型、数据）再按名字排序；没有元素的节点不展开。
 *   一个节点最多 SURFACE_PORT_CAP 个元素端口：按本层接到它的节点数取前若干（交互接到的优先），其余计入「+N 个元素」（边接到节点本体，清单在面板「表面」一节）。
 *   L20b：封顶后的元素端口先按所属子模块（元素 owner 在接收方之下的那一级，groupOf）分组——子模块组按声明顺序，本体的元素一组排在最后；组内按种类、名字。
 *   L20a②（ADR-0036）：另给组号（布局留组间距）与优先次序（入边一侧放不下时布局从末尾截掉，计入「+N」）。
 */
import { ELEMENT_KINDS, type ElementKind, type InteractionBundle, type LevelView } from '@/model'
import type { ElementLink, StructureLinks, SurfaceExpand } from './layout'

/** C6、L20：一个展开节点最多画的端口点数（定尺寸节点的入边一侧一排放得下；其余收进「+N」，清单在面板「表面」一节，图例注明） */
export const SURFACE_PORT_CAP = 16

export interface ExpansionInput {
  view: LevelView
  selection: { kind: string; id: string } | null
  /** 显示偏好「总是展开表面」（surfaceAlways） */
  always: boolean
  /** 本层的束与元素级边（desk.facts 的并集布局输入，不含展开） */
  links: StructureLinks | null
  /** D7：本层交互视图边按接收方表面散开的数据（desk.facts.interactionSpread） */
  spreads: ReadonlyMap<string, InteractionBundle> | null
  /** L20b：展开节点的元素所属的子模块（rank 为它在接收方下的声明顺序）；本体或未知为 null。不给时不分组 */
  groupOf?: (node: string, element: string) => { sub: string; rank: number } | null
}

export interface Expansion {
  expand: SurfaceExpand[]
  interactions: { edge: string; elements: string[] }[]
}

/** 能展开表面的节点：普通层次的内部模块（含核心模块） */
const expandable = (n: LevelView['nodes'][number]) => (n.role === 'module' || n.role === 'core') && !n.rim

/** C6：本层要展开的节点与元素；没有时为 null */
export function surfaceExpansion({ view, selection: sel, always, links, spreads, groupOf }: ExpansionInput): Expansion | null {
  if (view.mode === 'layered') return null
  const nodes = view.nodes.filter(expandable)
  const want = new Map<string, string[] | null>()
  const add = (node: string | undefined, from: string[] | null) => {
    if (!node || !nodes.some(n => n.id === node)) return
    const was = want.get(node)
    want.set(node, was === null || from === null ? null : [...new Set([...(was ?? []), ...from])])
  }
  if (always) for (const n of nodes) add(n.id, null)
  if (sel?.kind === 'module') add(nodes.find(n => n.moduleId === sel.id)?.id, null)
  else if (sel?.kind === 'relation' || sel?.kind === 'edge') {
    const e = view.edges.find(x => (sel.kind === 'edge' ? x.id === sel.id : x.relationIds.includes(sel.id)))
    if (e) add(e.to, [e.from])
  }
  if (!want.size) return null

  const kinds = new Map<string, ElementKind>()
  const expand: SurfaceExpand[] = []
  const interactions: Expansion['interactions'] = []
  for (const [node, from] of want) {
    const inScope = (src: string) => from === null || from.includes(src)
    const names = new Set<string>()
    const users = new Map<string, Set<string>>()
    const use = (name: string, src: string) => (users.get(name) ?? users.set(name, new Set()).get(name)!).add(src)
    for (const e of links?.elements ?? [])
      if (e.to === node && e.element && inScope(e.from)) {
        names.add(remember(kinds, node, e))
        use(e.element, e.from)
      }
    const hit = new Set<string>()
    const edgeEls: { edge: string; elements: Set<string> }[] = []
    for (const e of view.edges) {
      if (e.to !== node || !inScope(e.from)) continue
      const els = new Set<string>()
      for (const it of spreads?.get(e.id)?.items ?? [])
        if (it.element) {
          kinds.set(`${node}|${it.element.name}`, it.element.kind)
          els.add(it.element.name)
          names.add(it.element.name)
          hit.add(it.element.name)
          use(it.element.name, e.from)
        }
      if (els.size) edgeEls.push({ edge: e.id, elements: els })
    }
    if (!names.size) continue
    // 端口数封顶：交互接到的优先，其余按接到它的节点数、再按名字
    const top = [...names]
      .sort((x, y) => Number(hit.has(y)) - Number(hit.has(x)) || (users.get(y)?.size ?? 0) - (users.get(x)?.size ?? 0) || x.localeCompare(y))
      .slice(0, SURFACE_PORT_CAP)
    const keep = new Set(top)
    const rank = (n: string) => ELEMENT_KINDS.indexOf(kinds.get(`${node}|${n}`) ?? 'operation')
    const group = (n: string) => groupOf?.(node, n)?.rank ?? Infinity
    const elements = [...top].sort((x, y) => group(x) - group(y) || rank(x) - rank(y) || x.localeCompare(y))
    // L20b、L20a②：组号交给布局留组间距（有属于子模块的元素时才给），优先次序交给布局在入边一侧放不下时截掉
    const groups = elements.map(n => groupOf?.(node, n)?.rank ?? null)
    expand.push({
      node,
      elements,
      from,
      ...(names.size > keep.size ? { more: names.size - keep.size } : {}),
      ...(groups.some(g => g !== null) ? { groups } : {}),
      ranked: top,
    })
    for (const x of edgeEls) {
      const els = [...x.elements].filter(n => keep.has(n))
      if (els.length) interactions.push({ edge: x.edge, elements: els })
    }
  }
  if (!expand.length) return null
  const open = new Set(expand.map(x => x.node))
  return { expand, interactions: interactions.filter(x => open.has(view.edges.find(e => e.id === x.edge)!.to)) }
}

function remember(kinds: Map<string, ElementKind>, node: string, e: ElementLink): string {
  if (e.kind && !kinds.has(`${node}|${e.element}`)) kinds.set(`${node}|${e.element}`, e.kind)
  return e.element!
}
