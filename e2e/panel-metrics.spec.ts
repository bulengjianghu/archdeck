/**
 * L46（第十七轮 R3.8）：首屏守——属性栏的理解卡一屏读完（C3「主路径一屏读完」）。
 * 条件：1440×900 视口（Playwright 缺省）、属性栏并排（330px，WS-3）、结构视角的静息态（不滚动、不展开理解卡里的折叠块）。
 * 断言：media-web-player 的 kit 与 kit.kernel，理解卡的底边在属性栏可视区之内（R3.8）。
 * 其余对象（h5p-arch-desk present.canvas、h5player app.solution、三个项目的系统面板）只记录基线、不断言：
 * 超出的是描述写长了（summary / 原则 / 不变式），按 M27 与 04 改描述，不在界面截字。
 * 第十五轮的「常显行数」口径与上限 36 / 33 / 39 作废：三卡之后证据都在核对卡的折叠清单里，行数不再反映首屏。
 */
import { expect, test, type Page } from '@playwright/test'
import { openDesk, waitSettled } from './helpers'

interface Measure {
  /** 理解卡的上沿、底边（px） */
  top: number
  bottom: number
  /** 属性栏可视区的底边（px） */
  limit: number
  /** 理解卡的高（px） */
  height: number
  /** 属性栏是否并排（WS-3） */
  docked: boolean
}

const MEASURE = `(() => {
  const area = document.querySelector('.panel-area')
  const card = document.querySelector('.panel [data-card="understand"]')
  const props = document.querySelector('aside.props')
  if (!area || !card || !props) return null
  const a = area.getBoundingClientRect()
  const c = card.getBoundingClientRect()
  return { top: Math.round(c.top), bottom: Math.round(c.bottom), limit: Math.round(Math.min(a.bottom, window.innerHeight)), height: Math.round(c.height), docked: !props.classList.contains('floating') }
})()`

/** 读数连续三次相同才算布局与代码事实都就绪（参考 G9 waitSettled 的做法） */
async function measureStable(page: Page): Promise<Measure> {
  let last = ''
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await page.evaluate(MEASURE))
        const same = now === last && now !== 'null'
        last = now
        return same ? 'stable' : 'moving'
      },
      { intervals: [300] },
    )
    .toBe('stable')
  return JSON.parse(last) as Measure
}

async function open(page: Page, path: string) {
  await openDesk(page, path)
  await waitSettled(page)
  // 代码事实就绪：核对卡的结论不再是「读取中」（没有代码事实时也会定下来）
  await expect(page.locator('.panel [data-card="check"] .card-sum').first()).not.toHaveText(/读取中/, { timeout: 20_000 })
  return measureStable(page)
}

const GUARDED = [
  { project: 'media-web-player', module: 'kit', level: '' },
  { project: 'media-web-player', module: 'kit.kernel', level: 'kit' },
]

for (const c of GUARDED) {
  test(`L46 首屏守（R3.8）· ${c.project} ${c.module}：理解卡一屏读完`, async ({ page }) => {
    const m = await open(page, `/p/${c.project}?${c.level ? `level=${c.level}&` : ''}sel=m:${c.module}&v=s`)
    console.log(`PANEL_BASELINE ${c.project} ${c.module} understand top=${m.top} bottom=${m.bottom} limit=${m.limit} height=${m.height}`)
    expect(m.docked, '1440 宽、没有资料区时属性栏并排').toBe(true)
    expect(m.bottom).toBeLessThanOrEqual(m.limit)
  })
}

const RECORDED = [
  { project: 'h5p-arch-desk', path: '/p/h5p-arch-desk?level=present&sel=m:present.canvas&v=s', label: 'present.canvas' },
  { project: 'h5player', path: '/p/h5player?level=app&sel=m:app.solution&v=s', label: 'app.solution' },
  { project: 'h5p-arch-desk', path: '/p/h5p-arch-desk', label: '系统' },
  { project: 'h5player', path: '/p/h5player', label: '系统' },
  { project: 'media-web-player', path: '/p/media-web-player', label: '系统' },
]

test('L46 基线记录（不断言）：其余项目的模块与系统面板的理解卡底边', async ({ page }) => {
  test.setTimeout(120_000)
  for (const r of RECORDED) {
    const m = await open(page, r.path)
    console.log(`PANEL_BASELINE ${r.project} ${r.label} understand top=${m.top} bottom=${m.bottom} limit=${m.limit} height=${m.height}`)
    expect(m.height).toBeGreaterThan(0)
  }
})

/*
 * 基线（2026-10-30，第十七轮 W3，1440×900、属性栏并排、结构视角）：
 *
 * | 项目 | 对象 | 理解卡 上沿 → 底边 px | 可视区底边 | 一屏读完 |
 * |---|---|---|---|---|
 * | media-web-player | kit | 140 → 691 | 900 | 是（守） |
 * | media-web-player | kit.kernel | 140 → 873 | 900 | 是（守） |
 * | h5p-arch-desk | present.canvas | 166 → 704 | 900 | 是（记录） |
 * | h5player | app.solution | 112 → 865 | 900 | 是（记录） |
 * 系统面板的读数见运行日志（PANEL_BASELINE … 系统）。
 */
