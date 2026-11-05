/**
 * L46（第十七轮 R3.8；第二十轮读先方案改写）：首屏守——理解面一屏读完。
 * 理解卡已搬去辅助栏的理解页（事实卡 + 故事，ModuleDoc）：选中模块自动打开资料区，
 * 断言事实卡（理解节）的底边在辅助栏可视区之内，画布列 ≥ 640；系统面板的理解卡仍在抽屉里，只记录基线。
 * 超出的是描述写长了（summary / 原则 / 不变式），按 M27 与 04 改描述，不在界面截字。
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
  // 事实卡在辅助栏的理解页里；系统面板的理解卡还在抽屉——两处都认，量各自可视区的底边
  const dockCard = document.querySelector('.dock [data-sec="understand"]')
  const dockArea = document.querySelector('.dock-area')
  const panelCard = document.querySelector('.panel [data-card="understand"]')
  const panelArea = document.querySelector('.panel-area')
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
  // 选中即自动打开辅助栏的理解页（事实卡 + 故事）——它就是首屏守的量测对象，不再关掉
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
