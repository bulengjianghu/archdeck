/**
 * L30（ADR-0039）：线的清晰度——几何检查器自身的单测，与三个项目所有层次的计数回归（只降不升）。
 * 计数随描述与布局变化：改动让某一类下降时把 CEILING 改成新的数（`CLARITY_REPORT=1 npx vitest run tests/layout/clarity/report.test.ts` 打印，
 * `CLARITY_REPORT=levels` 逐层、`CLARITY_LEVEL=<项目>:<层次>` 逐条）；上升说明有回退，先看明细再决定。
 */
import { describe, expect, it } from 'vitest'
import { check, countFindings, KINDS, type CheckLine, type Counts } from './checker'
import { PROJECTS, checkProject } from './scenes'

const line = (id: string, pts: [number, number][], extra: Partial<CheckLine> = {}): CheckLine => ({
  id,
  points: pts.map(([x, y]) => ({ x, y })),
  ends: ['a', 'b'],
  ...extra,
})
const kinds = (f: ReturnType<typeof check>) => f.map(x => x.kind)

describe('L30 几何检查器', () => {
  it('overlap：平行且相距不到 6 px、重叠超过 6 px 的两段算重合；相距一个轨距（10）不算', () => {
    const a = line('a', [
      [0, 0],
      [100, 0],
    ])
    expect(
      kinds(
        check({
          lines: [
            a,
            line('b', [
              [20, 3],
              [80, 3],
            ]),
          ],
          obstacles: [],
          frames: [],
        }),
      ),
    ).toContain('overlap')
    expect(
      kinds(
        check({
          lines: [
            a,
            line('b', [
              [20, 10],
              [80, 10],
            ]),
          ],
          obstacles: [],
          frames: [],
        }),
      ),
    ).not.toContain('overlap')
  })

  it('arrows：两条线的终点相距不到 4 px', () => {
    const f = check({
      lines: [
        line('a', [
          [0, 0],
          [0, 50],
        ]),
        line('b', [
          [40, 0],
          [2, 50],
        ]),
      ],
      obstacles: [],
      frames: [],
    })
    expect(kinds(f)).toContain('arrows')
  })

  it('crossNode：穿过节点内部、或穿过带的文字区；从自己两端节点的边上出入不算', () => {
    const box = { x: 0, y: 40, w: 100, h: 40 }
    const into = line(
      'a',
      [
        [50, 0],
        [50, 40],
      ],
      { ends: ['n', 'x'] },
    )
    const through = line('b', [
      [50, 0],
      [50, 120],
    ])
    const f = check({ lines: [into, through], obstacles: [{ id: 'n', box, kind: 'node' }], frames: [] })
    expect(f.filter(x => x.kind === 'crossNode').map(x => x.ids[0])).toEqual(['b'])
  })

  it('labels：标签互压、标签压节点', () => {
    const l1 = line(
      'a',
      [
        [0, 0],
        [100, 0],
      ],
      { label: { at: { x: 50, y: 0 }, text: '×3 · 2 把手' } },
    )
    const l2 = line(
      'b',
      [
        [0, 8],
        [100, 8],
      ],
      { label: { at: { x: 55, y: 8 }, text: '×2' } },
    )
    expect(kinds(check({ lines: [l1, l2], obstacles: [], frames: [] }))).toContain('labels')
  })

  it('hug：与框线平行、相距不到 6 px、并行超过 24 px', () => {
    const frame = { x: 0, y: 0, w: 200, h: 200 }
    expect(
      kinds(
        check({
          lines: [
            line('a', [
              [20, 4],
              [120, 4],
            ]),
          ],
          obstacles: [],
          frames: [frame],
        }),
      ),
    ).toContain('hug')
    expect(
      kinds(
        check({
          lines: [
            line('a', [
              [20, 14],
              [120, 14],
            ]),
          ],
          obstacles: [],
          frames: [frame],
        }),
      ),
    ).not.toContain('hug')
  })

  it('onFrame：终点落在框线上、不在任何节点的边上', () => {
    const frame = { x: 0, y: 0, w: 200, h: 200 }
    expect(
      kinds(
        check({
          lines: [
            line('a', [
              [50, -40],
              [50, 0],
            ]),
          ],
          obstacles: [],
          frames: [frame],
        }),
      ),
    ).toContain('onFrame')
  })

  it('多个场景里同一组线的同一类问题只计一次', () => {
    const f = { kind: 'overlap' as const, ids: ['a', 'b'], at: { x: 0, y: 0 } }
    expect(countFindings([f, f]).overlap).toBe(1)
  })
})

/** 三个项目所有层次（交互视角，分层总览含逐个聚焦核心模块，普通层次含全部框外边）的计数上限：只降不升 */
const CEILING: Record<(typeof PROJECTS)[number], Counts> = {
  'h5p-arch-desk': { overlap: 40, arrows: 0, crossNode: 3, labels: 1, hug: 6, onFrame: 0 },
  h5player: { overlap: 87, arrows: 0, crossNode: 0, labels: 2, hug: 14, onFrame: 0 },
  'media-web-player': { overlap: 52, arrows: 0, crossNode: 1, labels: 0, hug: 7, onFrame: 0 },
}

describe('L30 计数回归（只降不升）', () => {
  for (const p of PROJECTS)
    it(
      p,
      async () => {
        const { total } = await checkProject(p)
        for (const k of KINDS) expect({ kind: k, count: total[k] }).toEqual({ kind: k, count: Math.min(total[k], CEILING[p][k]) })
      },
      120000,
    )
})
