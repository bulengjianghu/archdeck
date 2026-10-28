/**
 * W（ADR-0039）：把三个项目所有层次的布局结果换成几何检查器的场景（checker.ts）。
 *   分层总览：常显的一组（层间边、侧边通道边、框外边）为一个场景；每个核心模块被聚焦时再加它的核心跨层边（O4）为一个场景。
 *   普通层次：内部边 + 全部框外边一起走线（运行视角「全显」，框外边最多的情形）为一个场景。
 * 布局与产品一致：结构边（L15 并集布局）、分层总览的核心跨层束与按值依赖的分层（L28）由 state/desk/layoutLinks.ts 构造，代码事实按 vite/readHealth.ts 同样读出。
 * 层带的层号、环组框的环编号是文字区（障碍），环组框是框线。
 * 标签文字取画布同一口径：把手角标（L23b）或 ×N（L10）。
 * 结构视角（有代码事实时）另成一组：缺省显示偏好下画出来的束——照画的异常束（基线外违规、环上、逆稳定，L15a①）、
 *   交互使用与值使用的兄弟束（只引类型收起 B1、一端是边界节点的折叠 B2、共用件按 O13② 收起），走线与标签同画布（canvas/structure.ts、edges.ts）。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  assignFiles,
  governanceReport,
  isTarget,
  levelFacts,
  levelTiers,
  loadModel,
  shelfOf,
  projectLevel,
  structureView,
  type GovernanceReport,
  type LevelView,
  type ModelIndex,
  type StructureView,
  type ViewEdge,
} from '../../../src/model'
import {
  BAND,
  bandTextBoxes,
  edgeLabel,
  handleBadge,
  isOutsideEdge,
  layoutView,
  outsideRoutes,
  tierTextBoxes,
  type Box,
  type EdgeRoute,
  type PositionedView,
} from '../../../src/layout/layout'
import { routeMidpoint } from '../../../src/layout/canvas'
import { bundleItem, depViewEdge, routeToPoint } from '../../../src/layout/canvas/structure'
import { composeLabel } from '../../../src/layout/canvas/labels'
import { readModelDir } from '../../../vite/readModelDir'
import { readSourceTree } from '../../../vite/readSource'
import { readCodeDeps } from '../../../vite/readDeps'
import { governanceDir, readBaseline } from '../../../vite/governanceStore'
import { baseLayoutLinks, toLayoutTiers } from '../../../src/state/desk/layoutLinks'
import { check, countFindings, type CheckLine, type Counts, type Finding, type Obstacle, type Scene } from './checker'

export const PROJECTS = ['h5p-arch-desk', 'h5player', 'media-web-player'] as const

const MODEL_ROOT = path.resolve(__dirname, '../../../model')

export interface Project {
  index: ModelIndex
  /** 代码事实；源码读不到时为 null（布局退回只按交互边与允许边） */
  report: GovernanceReport | null
}

const PACKAGE_ROOT = path.resolve(__dirname, '../../..')

export function loadProject(id: string): Project {
  if (!fs.existsSync(path.join(MODEL_ROOT, id))) throw new Error(`没有项目 ${id}`)
  const { files } = readModelDir(path.join(MODEL_ROOT, id), MODEL_ROOT)
  const { index } = loadModel(files)
  const tree = readSourceTree(MODEL_ROOT, id, PACKAGE_ROOT)
  if (!tree || tree.status !== 'local') return { index, report: null }
  const own = assignFiles(index, tree.files, index.model.sourceIgnore)
  const report = governanceReport(index, own, tree, readCodeDeps(tree.root, tree.files, tree.packages), readBaseline(governanceDir(MODEL_ROOT, id)))
  return { index, report }
}

/** 有子模块的全部层次（含根），按路径排序 */
export function levelIds(index: ModelIndex): string[] {
  const ids = [index.rootId, ...[...index.childrenOf.keys()].filter(id => id !== index.rootId && (index.childrenOf.get(id)?.length ?? 0) > 0)]
  return [...new Set(ids)].sort()
}

const labelText = (index: ModelIndex, view: LevelView, e: ViewEdge) => handleBadge(index, view, e)?.label || edgeLabel(e)

function lineOf(index: ModelIndex, view: LevelView, e: ViewEdge, r: EdgeRoute, id = e.id): CheckLine {
  const text = labelText(index, view, e)
  const at = r.label ?? routeMidpoint(r)
  return { id, points: r.points, ...(r.curve ? { curve: r.curve } : {}), ...(text ? { label: { at, text } } : {}), ends: [e.from, e.to] }
}

function obstaclesOf(pv: PositionedView): { obstacles: Obstacle[]; frames: Box[]; anchors: Box[] } {
  const bandIds = new Set((pv.view.bands ?? []).map(b => b.layerId))
  const obstacles: Obstacle[] = []
  const anchors: Box[] = []
  for (const [id, box] of pv.nodes) {
    if (!bandIds.has(id)) {
      obstacles.push({ id, box, kind: 'node' })
      continue
    }
    anchors.push(box)
    // 带的文字区：左侧标题与说明栏、右侧「可依赖」栏、上边框的计数标签（O11）
    const band = pv.view.bands!.find(b => b.layerId === id)!
    const [title, deps, counts] = bandTextBoxes(box, !!(band.shelf?.length || band.hiddenCount))
    obstacles.push({ id: `${id}#title`, box: title, kind: 'text' }, { id: `${id}#deps`, box: deps, kind: 'text' })
    if (counts) obstacles.push({ id: `${id}#counts`, box: counts, kind: 'text' })
  }
  tierTextBoxes(pv.tiers).forEach((box, i) => obstacles.push({ id: `tier-text:${i}`, box, kind: 'text' }))
  const frames = [pv.frame, pv.parentFrame, ...[...bandIds].map(id => pv.nodes.get(id)), ...(pv.tiers?.groups ?? []).map(g => g.box)].filter(
    (b): b is Box => !!b,
  )
  return { obstacles, frames, anchors }
}

export interface LevelResult {
  level: string
  findings: Finding[]
  counts: Counts
}

/**
 * 结构视角缺省（不聚焦、不展开表面、显示偏好全关）时画出来的束——与 facts.ts 的 anomalies / structureDisplay、canvas/structure.ts 的 keep 同口径。
 */
function structureLines(
  index: ModelIndex,
  view: LevelView,
  sv: Extract<StructureView, { facts: true }>,
  report: GovernanceReport,
  pv: PositionedView,
): CheckLine[] {
  const facts = levelFacts(index, view, report)
  const cycEdges = new Set(facts.levelCycles.flatMap(c => c.edges.map(e => `${e.from}->${e.to}`)))
  const odd = (b: (typeof sv.bundles)[number]) =>
    b.ruling.status === 'new' || b.ruling.status === 'open' || cycEdges.has(`${b.from}->${b.to}`) || b.againstStability
  const bnd = new Set(view.nodes.filter(n => n.role === 'boundary' || n.rim || (index.modules.has(n.moduleId) && isTarget(index, n.moduleId))).map(n => n.id))
  const shelf = shelfOf(view)
  const inCycle = (b: { from: string; to: string }) => facts.cycles.get(b.from) !== undefined && facts.cycles.get(b.from) === facts.cycles.get(b.to)
  const shown = sv.bundles.filter(b => {
    if (odd(b)) return true
    if (b.tier === 'type') return false
    if (bnd.has(b.from) || bnd.has(b.to)) return false
    if (shelf.has(b.from) || shelf.has(b.to)) return inCycle(b) || (shelf.has(b.from) && !shelf.has(b.to))
    return true
  })
  const items = shown.map(b => bundleItem(index, b, []))
  const outside = view.mode === 'layered' ? new Map<string, EdgeRoute>() : outsideRoutes(pv, items.map(depViewEdge))
  return items.flatMap(e => {
    const r =
      outside.get(e.id) ??
      pv.edges.get(e.id) ??
      (shelf.has(e.from) || shelf.has(e.to) ? routeToPoint(pv.nodes.get(e.from), undefined, pv.nodes.get(e.to)) : undefined)
    if (!r) return []
    const head = e.look.rest ? `×${e.look.elements} 其余` : e.look.elements ? `×${e.look.elements} 元素` : ''
    const tags = [...(e.look.violation === 'new' ? [{ tag: '违规' as const }] : []), ...(e.look.unexplained ? [{ tag: '未解释' as const }] : [])]
    const text = [composeLabel(head, tags), e.look.bypass ? '越过入口' : '', e.look.against ? '逆稳定' : ''].filter(Boolean).join(' · ')
    const at = r.label ?? routeMidpoint(r)
    return [{ id: e.id, points: r.points, ...(r.curve ? { curve: r.curve } : {}), ...(text ? { label: { at, text } } : {}), ends: [e.from, e.to] as const }]
  })
}

/** perspective：interaction 为交互视角的线（缺省）；structure 为结构视角的束（只在有代码事实时，否则为 null） */
export async function checkLevel(
  { index, report }: Project,
  level: string,
  perspective: 'interaction' | 'structure' = 'interaction',
): Promise<LevelResult | null> {
  let view: LevelView
  try {
    view = projectLevel(index, level)
  } catch {
    return null
  }
  if (!view.nodes.length) return null
  // 与 DeskState 同一份布局输入（facts.ts 的 baseLinks）：结构边、核心跨层束、分层
  const sv = structureView(index, view, report)
  const tiers = report ? toLayoutTiers(levelTiers(index, view, report)) : null
  const pv = { ...(await layoutView(view, {}, baseLayoutLinks(index, view, sv, report, tiers))), view }
  const { obstacles, frames, anchors } = obstaclesOf(pv)
  const scenes: Scene[] = []
  if (perspective === 'structure') {
    if (!sv.facts || !report) return null
    scenes.push({ lines: structureLines(index, view, sv, report, pv), obstacles, frames, anchors })
  } else if (view.mode === 'layered') {
    const base = view.edges.flatMap(e => {
      const r = pv.edges.get(e.id)
      return r ? [lineOf(index, view, e, r)] : []
    })
    scenes.push({ lines: base, obstacles, frames, anchors })
    const cores = new Set((view.coreEdges ?? []).flatMap(e => [e.from, e.to]))
    for (const n of cores) {
      const extra = (view.coreEdges ?? []).flatMap(e => {
        const r = pv.coreEdges.get(e.id)
        return r && (e.from === n || e.to === n) ? [lineOf(index, view, e, r, `core:${e.id}`)] : []
      })
      if (extra.length) scenes.push({ lines: [...base, ...extra], obstacles, frames, anchors })
    }
  } else {
    const inner = view.edges.flatMap(e => {
      const r = pv.edges.get(e.id)
      return r && !isOutsideEdge(view, e) ? [lineOf(index, view, e, r)] : []
    })
    const outside = outsideRoutes(pv, view.edges)
    const outer = view.edges.flatMap(e => {
      const r = outside.get(e.id)
      return r ? [lineOf(index, view, e, r)] : []
    })
    scenes.push({ lines: [...inner, ...outer], obstacles, frames, anchors })
  }
  const findings = scenes.flatMap(check)
  return { level, findings, counts: countFindings(findings) }
}

/** facts 为 false 时按没有代码事实的布局量（设计版本、提交版本：只按交互边与允许边，不分层） */
export async function checkProject(
  id: string,
  opts: { facts?: boolean; perspective?: 'interaction' | 'structure' } = {},
): Promise<{ levels: LevelResult[]; total: Counts }> {
  const loaded = loadProject(id)
  const project = opts.facts === false ? { ...loaded, report: null } : loaded
  const levels: LevelResult[] = []
  for (const level of levelIds(project.index)) {
    const r = await checkLevel(project, level, opts.perspective)
    if (r) levels.push(r)
  }
  const total = countFindings(levels.flatMap(l => l.findings.map(f => ({ ...f, ids: [l.level, ...f.ids] }))))
  return { levels, total }
}

export { BAND }
