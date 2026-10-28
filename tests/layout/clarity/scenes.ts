/**
 * W（ADR-0039）：把三个项目所有层次的布局结果换成几何检查器的场景（checker.ts）。
 *   分层总览：常显的一组（层间边、侧边通道边、框外边）为一个场景；每个核心模块被聚焦时再加它的核心跨层边（O4）为一个场景。
 *   普通层次：内部边 + 全部框外边一起走线（运行视角「全显」，框外边最多的情形）为一个场景。
 * 布局与产品一致：结构边（L15 并集布局）、分层总览的核心跨层束与按值依赖的分层（L28）由 state/desk/layoutLinks.ts 构造，代码事实按 vite/readHealth.ts 同样读出。
 * 层带的层号、环组框的环编号是文字区（障碍），环组框是框线。
 * 标签文字取画布同一口径：把手角标（L23b）或 ×N（L10）。只看交互视角的线；结构视角的束另有口径，不在这里。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  assignFiles,
  governanceReport,
  levelTiers,
  loadModel,
  projectLevel,
  structureView,
  type GovernanceReport,
  type LevelView,
  type ModelIndex,
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

export async function checkLevel({ index, report }: Project, level: string): Promise<LevelResult | null> {
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
  if (view.mode === 'layered') {
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
export async function checkProject(id: string, opts: { facts?: boolean } = {}): Promise<{ levels: LevelResult[]; total: Counts }> {
  const loaded = loadProject(id)
  const project = opts.facts === false ? { ...loaded, report: null } : loaded
  const levels: LevelResult[] = []
  for (const level of levelIds(project.index)) {
    const r = await checkLevel(project, level)
    if (r) levels.push(r)
  }
  const total = countFindings(levels.flatMap(l => l.findings.map(f => ({ ...f, ids: [l.level, ...f.ids] }))))
  return { levels, total }
}

export { BAND }
