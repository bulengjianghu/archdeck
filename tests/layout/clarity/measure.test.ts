/**
 * 第十四轮共同纪律：静息态常显的线数与交叉数（每波报告前后对比）。只在 CLARITY_MEASURE 设了时跑：
 *   CLARITY_MEASURE=1 输出三个项目 × 两个视角的合计；CLARITY_MEASURE=levels 另列每个层次。
 * 线 = 几何检查器场景的第一组（静息态：交互视角为内部边 + 框外边或分层总览的常显边；结构视角为缺省显示偏好下画出来的束）；
 * 交叉 = 两条不同的线的线段在端点以外相交（正交走线：一横一竖相交）。
 */
import { it } from 'vitest'
import { PROJECTS, levelIds, loadProject, restLines } from './scenes'
import type { CheckLine } from './checker'

type Pt = { x: number; y: number }

function segs(l: CheckLine): [Pt, Pt][] {
  return l.points.slice(1).map((q, i) => [l.points[i], q] as [Pt, Pt])
}

/** 一横一竖（或一般位置）在两段内部相交；共端点、平行不算 */
function cross([a, b]: [Pt, Pt], [c, d]: [Pt, Pt]): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  const d1 = o(a, b, c)
  const d2 = o(a, b, d)
  const d3 = o(c, d, a)
  const d4 = o(c, d, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

export function crossings(lines: readonly CheckLine[]): number {
  let n = 0
  const all = lines.map(segs)
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) for (const s of all[i]) for (const t of all[j]) if (cross(s, t)) n++
  return n
}

it.skipIf(!process.env.CLARITY_MEASURE)(
  '静息态常显线数与交叉数',
  async () => {
    const rows: string[] = []
    for (const p of PROJECTS) {
      const project = loadProject(p)
      for (const perspective of ['interaction', 'structure'] as const) {
        let lines = 0
        let x = 0
        const detail: string[] = []
        for (const level of levelIds(project.index)) {
          const ls = await restLines(project, level, perspective)
          if (!ls) continue
          const c = crossings(ls)
          lines += ls.length
          x += c
          if (process.env.CLARITY_MEASURE === 'levels' && ls.length) detail.push(`  ${level}\tlines=${ls.length}\tcross=${c}`)
        }
        rows.push(`${p}\t${perspective}\tlines=${lines}\tcross=${x}`, ...detail)
      }
    }
    console.log(rows.join('\n'))
  },
  600000,
)
