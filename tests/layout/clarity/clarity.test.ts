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

/**
 * 三个项目所有层次（交互视角的线，分层总览含逐个聚焦核心模块，普通层次含全部框外边）的计数上限：只降不升；结构视角另见 STRUCTURE。
 * 布局与产品一致（state/desk/layoutLinks.ts：结构边、核心跨层束、按值依赖的分层）；BARE 为没有代码事实时的布局（设计版本、提交版本）。
 */
const CEILING: Record<(typeof PROJECTS)[number], Counts> = {
  'h5p-arch-desk': { overlap: 59, arrows: 1, crossNode: 3, labels: 0, hug: 7, onFrame: 0 },
  h5player: { overlap: 93, arrows: 1, crossNode: 2, labels: 1, hug: 18, onFrame: 0 },
  'media-web-player': { overlap: 23, arrows: 0, crossNode: 7, labels: 0, hug: 5, onFrame: 0 },
}
const BARE: Record<(typeof PROJECTS)[number], Counts> = {
  'h5p-arch-desk': { overlap: 38, arrows: 0, crossNode: 3, labels: 1, hug: 6, onFrame: 0 },
  h5player: { overlap: 96, arrows: 0, crossNode: 0, labels: 2, hug: 13, onFrame: 0 },
  'media-web-player': { overlap: 35, arrows: 0, crossNode: 1, labels: 0, hug: 6, onFrame: 0 },
}
/**
 * 结构视角（有代码事实，缺省显示偏好）画出来的束：基线录于 75ec65f 的布局（第十三轮修复，ADR-0040 否决节）；
 * 第十四轮 F9、F10（可推出与环内的静息态不画、例外照画，L42）与框外结构边按实际标签文字避让（L33）后重定：
 * h5p 3 / 1 / 1 → 1 / 0 / 0（重合 / 压节点 / 标签），h5player 重合 32 → 6、标签 18 → 3、贴框 4 → 3，media 重合 1 → 0、标签 1 → 0。
 * 任何常显的线都由所在视角的检查器测量（第十三轮评审 M7）；改变结构视角画线规则的改动，在这一组上量前后。
 */
const STRUCTURE: Record<(typeof PROJECTS)[number], Counts> = {
  'h5p-arch-desk': { overlap: 1, arrows: 0, crossNode: 0, labels: 0, hug: 0, onFrame: 0 },
  h5player: { overlap: 6, arrows: 0, crossNode: 0, labels: 3, hug: 3, onFrame: 0 },
  'media-web-player': { overlap: 0, arrows: 0, crossNode: 0, labels: 0, hug: 0, onFrame: 0 },
}
// ADR-0039 修订 1（没有端口记号的节点进边用整条边）后重定：h5p 箭头叠 25 → 1、重合 98 → 64；elk 端口约束变了、节点随之重排，
// 少数几类小幅上升（h5p 贴框 4 → 9，h5player 贴框 13 → 18、无代码事实的重合 66 → 96，media 压节点 5 → 7），明细与取舍见第十二轮 C-08 报告
// 第十四轮 F1（层号对全集算）后 h5p 重合 64 → 59、压节点 4 → 3、贴框 9 → 7

describe('L30 计数回归（只降不升）', () => {
  for (const [facts, limits] of [
    [true, CEILING],
    [false, BARE],
  ] as const)
    for (const p of PROJECTS)
      it(`${p}${facts ? '' : '（无代码事实）'}`, async () => {
        const { total } = await checkProject(p, { facts })
        for (const k of KINDS) expect({ kind: k, count: total[k] }).toEqual({ kind: k, count: Math.min(total[k], limits[p][k]) })
      }, 180000)
  for (const p of PROJECTS)
    it(`${p}（结构视角）`, async () => {
      const { total } = await checkProject(p, { perspective: 'structure' })
      for (const k of KINDS) expect({ kind: k, count: total[k] }).toEqual({ kind: k, count: Math.min(total[k], STRUCTURE[p][k]) })
    }, 180000)
})
