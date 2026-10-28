/**
 * 机制标签的实测（ADR-0041，`MECH_REPORT=1` 打印）：三个项目全部层次（缺省投影）画出来的交互边——层间边与核心跨层边都算（核心跨层边是聚焦时的上限）——
 * 每层带机制标签的边数、各机制的边数，以及标签位静息态写字的边数前后对比（前 = 第十四轮前：×N 与把手、回调、束内同步 / 异步或 via 不一致的「混合」）。
 */
import { it } from 'vitest'
import { MECHANISMS, projectLevel, type ModelIndex, type LevelView, type ViewEdge } from '../../../src/model'
import { edgeLabel, handleBadge } from '../../../src/layout/layout'
import { composeLabel, composePill } from '../../../src/layout/labels'
import { mechTags } from '../../../src/layout/routes'
import { PROJECTS, levelIds, loadProject } from './scenes'

/** 第十四轮前的标签位：×N 与把手、回调（L24）、混合（同步 / 异步或 via 不一致，D8） */
function before(index: ModelIndex, view: LevelView, e: ViewEdge): string {
  const rels = e.relationIds.map(id => index.relations.get(id)!).filter(Boolean)
  const cb = e.mechs?.['回调']
  const vias = new Set(rels.map(r => r.via ?? ''))
  return composeLabel(handleBadge(index, view, e)?.label || edgeLabel(e), [
    !!cb && { tag: '回调', count: cb, total: e.relationIds.length },
    (e.mode === 'mixed' || vias.size > 1) && { tag: '混合' },
  ])
}

const after = (index: ModelIndex, view: LevelView, e: ViewEdge): string =>
  composePill(handleBadge(index, view, e)?.label || edgeLabel(e), [...mechTags(e.mechs, e.relationIds.length), e.mode === 'mixed' && { tag: '混合' }]).text

it.skipIf(!process.env.MECH_REPORT)(
  '机制标签实测',
  () => {
    const out: string[] = []
    for (const p of PROJECTS) {
      const { index } = loadProject(p)
      const rows: { level: string; edges: number; mech: number; textBefore: number; textAfter: number; tags: Record<string, number> }[] = []
      for (const level of levelIds(index)) {
        let view: LevelView
        try {
          view = projectLevel(index, level)
        } catch {
          continue
        }
        if (!view.nodes.length) continue
        const edges = [...view.edges, ...(view.coreEdges ?? [])]
        const tags: Record<string, number> = {}
        let mech = 0
        for (const e of edges) {
          const ks = MECHANISMS.filter(m => e.mechs?.[m])
          if (ks.length) mech++
          for (const k of ks) tags[k] = (tags[k] ?? 0) + 1
        }
        rows.push({
          level,
          edges: edges.length,
          mech,
          textBefore: edges.filter(e => before(index, view, e)).length,
          textAfter: edges.filter(e => after(index, view, e)).length,
          tags,
        })
      }
      const ms = rows.map(r => r.mech).sort((a, b) => a - b)
      const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0)
      const all: Record<string, number> = {}
      rows.forEach(r => Object.entries(r.tags).forEach(([k, v]) => (all[k] = (all[k] ?? 0) + v)))
      out.push(
        `== ${p}  层次 ${rows.length}  有机制标签的层次 ${rows.filter(r => r.mech).length}  每层机制标签数 中位 ${ms[Math.floor(ms.length / 2)]} / 最大 ${ms[ms.length - 1]}  ` +
          `带机制标签的边 ${sum(r => r.mech)} / ${sum(r => r.edges)}  写字的边 前 ${sum(r => r.textBefore)} → 后 ${sum(r => r.textAfter)}`,
      )
      out.push(
        `   各机制（边数）：${Object.entries(all)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k} ${v}`)
          .join(' · ')}`,
      )
      for (const r of [...rows].sort((a, b) => b.mech - a.mech).slice(0, 6))
        out.push(
          `   ${r.level}：边 ${r.edges}，机制标签 ${r.mech}（${Object.entries(r.tags)
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')}），写字 ${r.textBefore} → ${r.textAfter}`,
        )
    }
    console.log(out.join('\n'))
  },
  900000,
)
