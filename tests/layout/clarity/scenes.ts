/**
 * W（ADR-0039）：把三个项目所有层次的布局结果换成几何检查器的场景（checker.ts）。
 *   分层总览：常显的一组（层间边、侧边通道边、框外边）为一个场景；每个核心模块被聚焦时再加它的核心跨层边（O4）为一个场景。
 *   普通层次：内部边 + 全部框外边一起走线（运行视角「全显」，框外边最多的情形）为一个场景。
 * 布局与产品一致：结构边（L15 并集布局）、分层总览的核心跨层束与按值依赖的分层（L28）由 state/desk/layoutLinks.ts 构造，代码事实按 vite/readHealth.ts 同样读出。
 * 层带的层号、环组框的环编号是文字区（障碍），环组框是框线。
 * 标签文字取画布同一口径：把手角标（L23b）或 ×N（L10）。
 * 结构视角（有代码事实时）另成一组：缺省显示偏好下画出来的束——照画的异常束（基线外违规、环上、逆稳定，L15a①）、
 *   交互使用与值使用的兄弟束（只引类型收起 B1、一端是边界节点的折叠 B2、共用件按 O13② 收起；第十四轮 F9、F10：例外照画、环内与可推出的静息态不画，K23、L42），
 *   走线与标签同画布（canvas/structure.ts、edges.ts）。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  assignFiles,
  gradeBundles,
  forcedExceptions,
  governanceReport,
  isTarget,
  levelFacts,
  levelTiers,
  layerUpward,
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
  labelWidth,
  layoutView,
  outsideRoutes,
  tierTextBoxes,
  type Box,
  type EdgeRoute,
  type PositionedView,
} from '../../../src/layout/layout'
import { overlayTags, routeMidpoint } from '../../../src/layout/canvas'
import { bundleItem, depLabel, depViewEdge, routeToPoint } from '../../../src/layout/canvas/structure'
import { composeLabel, composePill, pillWidth } from '../../../src/layout/labels'
import { mechTags } from '../../../src/layout/routes'
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

/**
 * 交互视角静息态的标签位（与画布 makeEdge 同口径，L26②、ADR-0041）：×N 与把手、向上（K22，分层是事实、不随开关）、机制（L35）、混合（L23），
 * 按两段与上限组装；只随「代码事实」开关出现的异常（违规、未证实）不算
 */
function labelOf(index: ModelIndex, view: LevelView, e: ViewEdge, up: ReadonlyMap<string, readonly string[]>) {
  const n = e.relationIds.length
  const ups = up.get(e.id)?.filter(id => e.relationIds.includes(id)) ?? []
  return composePill(handleBadge(index, view, e)?.label || edgeLabel(e), [
    ups.length > 0 && { tag: '向上', count: ups.length, total: n },
    ...mechTags(e.mechs, n),
    e.mode === 'mixed' && { tag: '混合' },
  ])
}

function lineOf(index: ModelIndex, view: LevelView, e: ViewEdge, r: EdgeRoute, up: ReadonlyMap<string, readonly string[]>, id = e.id): CheckLine {
  const pill = labelOf(index, view, e, up)
  const at = r.label ?? routeMidpoint(r)
  return {
    id,
    points: r.points,
    ...(r.curve ? { curve: r.curve } : {}),
    ...(pill.text ? { label: { at, text: pill.text, w: pillWidth(pill.segments) } } : {}),
    ends: [e.from, e.to],
  }
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
  const bnd = new Set(view.nodes.filter(n => n.role === 'boundary' || n.rim || (index.modules.has(n.moduleId) && isTarget(index, n.moduleId))).map(n => n.id))
  const shelf = shelfOf(view)
  // K23、L42（第十四轮 F9、F10）：同 desk.facts 的 grading——逐条的例外照画，环内与可推出的静息态不画
  const t = levelTiers(index, view, report)
  const g = gradeBundles({
    bundles: sv.bundles,
    inner: n => !bnd.has(n) && !shelf.has(n),
    cycleEdges: cycEdges,
    tier: t?.tier ?? null,
    ...(t?.foldSpan ? { noTier: new Set([t.foldSpan.node]) } : {}),
  })
  const forced = forcedExceptions(g, sv.bundles, n => !bnd.has(n) && !shelf.has(n))
  const shown = sv.bundles.filter(b => {
    if (forced.has(b.id)) return true
    if (b.tier === 'type') return false
    const grade = g.grade.get(b.id)
    if (grade === 'reducible' || grade === 'cycle') return false
    if (bnd.has(b.from) || bnd.has(b.to)) return false
    if (shelf.has(b.from) || shelf.has(b.to)) return shelf.has(b.from) && !shelf.has(b.to)
    return true
  })
  const items = shown.map(b => {
    const it = bundleItem(index, b, [])
    return g.exceptions.get(b.id)?.includes('upward') ? { ...it, look: { ...it.look, upward: true as const } } : it
  })
  const sizes = new Map(
    items.flatMap(e => {
      const t = depLabel(e.look).label
      return t ? [[e.id, { w: labelWidth(t), h: 18 }] as const] : []
    }),
  )
  const outside = view.mode === 'layered' ? new Map<string, EdgeRoute>() : outsideRoutes(pv, items.map(depViewEdge), sizes)
  return items.flatMap(e => {
    const r =
      outside.get(e.id) ??
      pv.edges.get(e.id) ??
      (shelf.has(e.from) || shelf.has(e.to) ? routeToPoint(pv.nodes.get(e.from), undefined, pv.nodes.get(e.to)) : undefined)
    if (!r) return []
    const text = depLabel(e.look).label
    const at = r.label ?? routeMidpoint(r)
    return [{ id: e.id, points: r.points, ...(r.curve ? { curve: r.curve } : {}), ...(text ? { label: { at, text } } : {}), ends: [e.from, e.to] as const }]
  })
}

function reducedLinks(
  index: ModelIndex,
  view: LevelView,
  sv: Extract<StructureView, { facts: true }>,
  report: GovernanceReport,
  links: ReturnType<typeof baseLayoutLinks>,
): ReturnType<typeof baseLayoutLinks> {
  const facts = levelFacts(index, view, report)
  const bnd = new Set(view.nodes.filter(n => n.role === 'boundary' || n.rim || (index.modules.has(n.moduleId) && isTarget(index, n.moduleId))).map(n => n.id))
  const shelf = shelfOf(view)
  const t = levelTiers(index, view, report)
  const g = gradeBundles({
    bundles: sv.bundles,
    inner: n => !bnd.has(n) && !shelf.has(n),
    cycleEdges: new Set(facts.levelCycles.flatMap(c => c.edges.map(e => `${e.from}->${e.to}`))),
    tier: t?.tier ?? null,
    ...(t?.foldSpan ? { noTier: new Set([t.foldSpan.node]) } : {}),
  })
  const drop = (id: string) => g.grade.get(id) === 'reducible' || g.grade.get(id) === 'cycle'
  return { ...links, edges: links.edges.filter(e => !drop(e.id)), ...(links.elements ? { elements: links.elements.filter(e => !drop(e.bundle)) } : {}) }
}

/** perspective：interaction 为交互视角的线（缺省）；structure 为结构视角的束（只在有代码事实时，否则为 null） */
export async function checkLevel(project: Project, level: string, perspective: 'interaction' | 'structure' = 'interaction'): Promise<LevelResult | null> {
  const scenes = await levelScenes(project, level, perspective)
  if (!scenes) return null
  const findings = scenes.flatMap(check)
  return { level, findings, counts: countFindings(findings) }
}

/** 第十四轮：静息态常显的线（场景的第一组）；不适用时为 null */
export async function restLines(project: Project, level: string, perspective: 'interaction' | 'structure'): Promise<readonly CheckLine[] | null> {
  const scenes = await levelScenes(project, level, perspective)
  return scenes ? (scenes[0]?.lines ?? []) : null
}

async function levelScenes({ index, report }: Project, level: string, perspective: 'interaction' | 'structure'): Promise<Scene[] | null> {
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
  const links = baseLayoutLinks(index, view, sv, report, tiers)
  // 第十四轮 F9 对照实验（ADR-0046，不上线）：CLARITY_ELK=reduced 时交给 elk 的束去掉静息态不画的（环内、可推出），量节点位置变了之后的线
  const pv = {
    ...(await layoutView(view, {}, process.env.CLARITY_ELK === 'reduced' && sv.facts && report ? reducedLinks(index, view, sv, report, links) : links)),
    view,
  }
  const { obstacles, frames, anchors } = obstaclesOf(pv)
  // K22（ADR-0041）：向上又不是控制反转的边——普通层次按算出的层号（有代码事实时），分层总览按声明的层序
  const ups = view.mode === 'layered' ? layerUpward(index, view) : report ? (levelTiers(index, view, report)?.upward ?? []) : []
  const up = new Map(ups.filter(u => !u.inversion).map(u => [u.edge, u.relations] as const))
  const scenes: Scene[] = []
  if (perspective === 'structure') {
    if (!sv.facts || !report) return null
    scenes.push({ lines: structureLines(index, view, sv, report, pv), obstacles, frames, anchors })
  } else if (view.mode === 'layered') {
    const base = view.edges.flatMap(e => {
      const r = pv.edges.get(e.id)
      return r ? [lineOf(index, view, e, r, up)] : []
    })
    scenes.push({ lines: base, obstacles, frames, anchors })
    // 第十四轮合入（B-09 2(b)）：同时性口径——聚焦核心模块时层间边变淡、不写标签（RouteEdge），只算核心跨层边之间的标签互压；
    // 只有选中一条核心跨层边、没有聚焦模块时，它才与带标签的层间边同时出现
    const quiet = base.map(({ label: _label, ...l }) => l)
    const cores = new Set((view.coreEdges ?? []).flatMap(e => [e.from, e.to]))
    for (const n of cores) {
      const extra = (view.coreEdges ?? []).flatMap(e => {
        const r = pv.coreEdges.get(e.id)
        return r && (e.from === n || e.to === n) ? [lineOf(index, view, e, r, up, `core:${e.id}`)] : []
      })
      if (extra.length) scenes.push({ lines: [...quiet, ...extra], obstacles, frames, anchors })
    }
    for (const e of view.coreEdges ?? []) {
      const r = pv.coreEdges.get(e.id)
      if (r) scenes.push({ lines: [...base, lineOf(index, view, e, r, up, `core:${e.id}`)], obstacles, frames, anchors })
    }
  } else {
    const inner = view.edges.flatMap(e => {
      const r = pv.edges.get(e.id)
      return r && !isOutsideEdge(view, e) ? [lineOf(index, view, e, r, up)] : []
    })
    // L44（第十四轮 F12）：常显的代码依赖叠加线（两端都在本层）取并集布局里束的走线，一起量；框外的只在聚焦时临时出现，不量
    const overlays = report ? levelFacts(index, view, report).overlays.filter(o => !o.from.startsWith('boundary:') && !o.to.startsWith('boundary:')) : []
    const innerOverlays = new Map(
      overlays.flatMap(o => {
        const r = pv.edges.get(`bundle:${o.from}->${o.to}`)
        return r ? [[o.id, r] as const] : []
      }),
    )
    const outside = outsideRoutes(pv, view.edges, undefined, innerOverlays.size ? innerOverlays : undefined)
    const outer = view.edges.flatMap(e => {
      const r = outside.get(e.id)
      return r ? [lineOf(index, view, e, r, up)] : []
    })
    const overlayLines = overlays.flatMap(o => {
      const r = pv.edges.get(`bundle:${o.from}->${o.to}`)
      if (!r) return []
      const text = composeLabel('', overlayTags(o))
      const at = r.label ?? routeMidpoint(r)
      return [{ id: o.id, points: r.points, ...(text ? { label: { at, text } } : {}), ends: [o.from, o.to] as const }]
    })
    scenes.push({ lines: [...inner, ...outer, ...overlayLines], obstacles, frames, anchors })
  }
  return scenes
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
