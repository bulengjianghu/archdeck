/**
 * W（ADR-0039）：把三个项目所有层次的布局结果换成几何检查器的场景（checker.ts）。
 *   分层总览：常显的一组（层间边、侧边通道边、框外边）为一个场景；每个核心模块被聚焦时再加它的核心跨层边（O4）为一个场景。
 *   普通层次：内部边 + 全部框外边一起走线（运行视角「全显」，框外边最多的情形）为一个场景。
 * 标签文字取画布同一口径：把手角标（L23b）或 ×N（L10）。只看交互视角；结构视角的束另有口径，不在这里。
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadModel, projectLevel, type LevelView, type ModelIndex, type ViewEdge } from '../../../src/model'
import {
  BAND,
  bandTextBoxes,
  edgeLabel,
  handleBadge,
  isOutsideEdge,
  layoutView,
  outsideRoutes,
  type Box,
  type EdgeRoute,
  type PositionedView,
} from '../../../src/layout/layout'
import { routeMidpoint } from '../../../src/layout/canvas'
import { readModelDir } from '../../../vite/readModelDir'
import { check, countFindings, type CheckLine, type Counts, type Finding, type Obstacle, type Scene } from './checker'

export const PROJECTS = ['h5p-arch-desk', 'h5player', 'media-web-player'] as const

const MODEL_ROOT = path.resolve(__dirname, '../../../model')

export function loadProject(id: string): ModelIndex {
  const { files } = readModelDir(path.join(MODEL_ROOT, id), MODEL_ROOT)
  if (!fs.existsSync(path.join(MODEL_ROOT, id))) throw new Error(`没有项目 ${id}`)
  return loadModel(files).index
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
  const frames = [pv.frame, pv.parentFrame, ...[...bandIds].map(id => pv.nodes.get(id))].filter((b): b is Box => !!b)
  return { obstacles, frames, anchors }
}

export interface LevelResult {
  level: string
  findings: Finding[]
  counts: Counts
}

export async function checkLevel(index: ModelIndex, level: string): Promise<LevelResult | null> {
  let view: LevelView
  try {
    view = projectLevel(index, level)
  } catch {
    return null
  }
  if (!view.nodes.length) return null
  const pv = { ...(await layoutView(view)), view }
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

export async function checkProject(id: string): Promise<{ levels: LevelResult[]; total: Counts }> {
  const index = loadProject(id)
  const levels: LevelResult[] = []
  for (const level of levelIds(index)) {
    const r = await checkLevel(index, level)
    if (r) levels.push(r)
  }
  const total = countFindings(levels.flatMap(l => l.findings.map(f => ({ ...f, ids: [l.level, ...f.ids] }))))
  return { levels, total }
}

export { BAND }
