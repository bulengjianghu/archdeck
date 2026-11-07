/**
 * L46（第十七轮 R3.8；第二十轮读先方案改写）：首屏守——理解面一屏读完。
 * 模块的理解节在视图区的图解标签（过渡：原理解页，事实卡 + 故事，ModuleDoc），
 * 断言事实卡（理解节）的底边在视图区可视区之内，画布列 ≥ 640（1440 宽、侧栏展开）；系统的理解卡在描述标签（原面板），只记录基线。
 * 超出的是描述写长了（summary / 原则 / 不变式），按 M27 与 04 改描述，不在界面截字。
 */
import { expect, test, type Page } from '@playwright/test'
import { openDesk, showView, waitSettled } from './helpers'

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
  // 模块：事实卡在图解标签（过渡：原理解页）；系统：理解卡在描述标签（原面板，第二十二轮波 2）——两处都认，量各自可视区的底边
  const dockCard = document.querySelector('[data-region="views"] [data-sec="understand"]')
  const dockArea = document.querySelector('.views-area')
  const panelCard = document.querySelector('[data-region="views"] .panel [data-card="understand"]')
  const panelArea = document.querySelector('[data-region="views"] .panel-wrap')
  const canvas = document.querySelector('main.canvas-area')
  const area = dockCard ? dockArea : panelArea
  const card = dockCard ?? panelCard
  if (!area || !card || !canvas) return null
  const a = area.getBoundingClientRect()
  const c = card.getBoundingClientRect()
  return { top: Math.round(c.top), bottom: Math.round(c.bottom), limit: Math.round(Math.min(a.bottom, window.innerHeight)), height: Math.round(c.height), docked: canvas.getBoundingClientRect().width >= 640 }
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

async function open(page: Page, path: string, _quietDock = false) {
  await openDesk(page, path)
  // 选中即自动打开辅助栏的理解页（事实卡 + 故事）——它就是首屏守的量测对象，不再关掉；
  // 没有理解页的对象（系统面板的理解卡还在抽屉里）拉开抽屉
  // LY-8：视图区常在；模块主语的图解标签（过渡：原理解页）带事实卡，系统主语的是根图解，理解卡在抽屉
  const inDock = path.includes('sel=m:')
  if (!inDock) await showView(page, 'description')
  await waitSettled(page)
  // 理解页的事实卡 / 描述标签的理解卡随描述即时渲染，等它出现即可
  const waitSel = inDock ? '[data-region="views"] [data-sec="understand"]' : '[data-region="views"] .panel [data-card="understand"]'
  await expect(page.locator(waitSel)).toBeVisible({ timeout: 20_000 })
  return measureStable(page)
}

const GUARDED = [
  { project: 'media-web-player', module: 'kit', level: '' },
  { project: 'media-web-player', module: 'kit.kernel', level: 'kit' },
]

for (const c of GUARDED) {
  test(`L46 首屏守（R3.8）· ${c.project} ${c.module}：理解卡一屏读完`, async ({ page }) => {
    const m = await open(page, `/p/${c.project}?${c.level ? `level=${c.level}&` : ''}sel=m:${c.module}&v=s`, true)
    console.log(`PANEL_BASELINE ${c.project} ${c.module} understand top=${m.top} bottom=${m.bottom} limit=${m.limit} height=${m.height}`)
    expect(m.docked, '1440 宽：画布列 ≥ 640').toBe(true)
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
 * 基线（1440×900、属性栏并排、结构视角）：
 *
 * | 项目 | 对象 | 第十七轮 W3（2026-10-30）上沿 → 底边 | 第十八轮 X2（2026-10-31，卡片版式）上沿 → 底边 | 可视区底边 | 一屏读完 |
 * |---|---|---|---|---|---|
 * | media-web-player | kit | 140 → 691 | 180 → 706 | 900 | 是（守） |
 * | media-web-player | kit.kernel | 140 → 873 | 180 → 886 | 900 | 是（守） |
 * | h5p-arch-desk | present.canvas | 166 → 704 | 206 → 724 | 900 | 是（记录） |
 * | h5player | app.solution | 112 → 865 | 152 → 876 | 900 | 是（记录） |
 * 卡片版式的上沿多了身份卡的动作行与卡间距（+40），由卡头收紧、理解卡内协作与子模块的行高 20 → 19 收回大半。
 * 系统面板的读数见运行日志（PANEL_BASELINE … 系统）。
 */
