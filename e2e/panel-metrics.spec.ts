/**
 * G15：面板测量装置（不变式 8「肉眼守不住的几何纪律交给机器守」的面板版，00-candidates §4）。
 * 对每个项目 × 每类对象（模块选一个内容丰富的：h5p present.canvas、h5player app.solution、media kit.kernel；系统 = 根层面板）
 * 测两个数，本波（G11 波 0b 原型）只**输出基线**、不断言上限——上限等波 2 铺开后由负责人定（基线数字同时记在本文件底部）：
 *
 * - 常显行数：面板静息态（不滚动、不展开）占用的行数。口径：① 头部算 2 行（标题行 + 徽标行），设计说明算 1 行（出现时）；
 *   每一节（含折叠节）的标题算 1 行；非折叠节的节体内每个一级行块（.section 的直接子元素，h3 之外）各算 1 行（块内不再展开，如子模块清单整块 1 行）；
 *   出处 footer 算 1 行。
 * - 首屏可读：1700×1100 视口、缺省面板宽，不滚动、不展开时 ①–④ 段是否全部在视口内（③ 无异常时不存在，按出现的段计）；
 *   输出布尔与缺口像素（④ 段最后一节的底边超出视口下沿多少 px，不缺为 0）。
 *
 * 模块面板在结构视角测量（v=s，④ 段最全：含结构指标与影响面、表面）；系统面板与视角无关。布局与代码事实就绪后再量
 * （waitSettled + 读数连续三次相同），测量稳定（G9）。测量在浏览器里执行（字符串表达式，本侧无 DOM 类型）。
 */
import { expect, test, type Page } from '@playwright/test'
import { openDesk, waitSettled } from './helpers'

test.use({ viewport: { width: 1700, height: 1100 } })

const CASES = [
  { project: 'h5p-arch-desk', module: 'present.canvas', level: 'present' },
  { project: 'h5player', module: 'app.solution', level: 'app' },
  { project: 'media-web-player', module: 'kit.kernel', level: 'kit' },
]

interface Measure {
  rows: number
  /** ①–④ 段最后一节的底边 y（px） */
  boundaryBottom: number
  firstScreenReadable: boolean
  gapPx: number
}

/** 常显行数与 ①–④ 段底边（口径见文件头注释）；data-sec 由面板骨架标在各段上（V15） */
const MEASURE = `(() => {
  const panel = document.querySelector('.panel-area .panel') || document.querySelector('.panel')
  if (!panel) return { rows: 0, boundaryBottom: 0, firstScreenReadable: false, gapPx: 0 }
  const vh = window.innerHeight
  let rows = 0
  // ① 头部 2 行 + 设计说明 1 行
  rows += panel.querySelector('.head') ? 2 : 0
  rows += panel.querySelector('.design-note') ? 1 : 0
  // 每节标题 1 行；非折叠节的体内一级行块各 1 行
  for (const sec of panel.querySelectorAll('.section')) {
    rows += 1
    if (!sec.classList.contains('folded')) rows += sec.querySelectorAll(':scope > *:not(h3)').length
  }
  rows += panel.querySelector('.src') ? 1 : 0
  // ④ 段最后一节的底边（data-sec^="boundary" 都属 ④；取最大底边）
  let bottom = 0
  for (const el of panel.querySelectorAll('[data-sec^="boundary"]')) {
    const box = el.getBoundingClientRect()
    if (box.top >= 0) bottom = Math.max(bottom, box.top + box.height)
  }
  return {
    rows,
    boundaryBottom: Math.round(bottom),
    firstScreenReadable: bottom > 0 && bottom <= vh,
    gapPx: Math.max(0, Math.ceil(bottom - vh)),
  }
})()`

/** 读数连续三次相同才算布局与代码事实都就绪（参考 G9 waitSettled 的做法） */
async function measureStable(page: Page): Promise<Measure> {
  let last = ''
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await page.evaluate(MEASURE))
        const same = now === last
        last = now
        return same ? 'stable' : 'moving'
      },
      { intervals: [300] },
    )
    .toBe('stable')
  return JSON.parse(last) as Measure
}

for (const c of CASES) {
  test(`G15 基线 · ${c.project} 模块面板（${c.module}，结构视角）：常显行数与首屏可读`, async ({ page }) => {
    await openDesk(page, `/p/${c.project}?level=${c.level}&sel=m:${c.module}&v=s`)
    await waitSettled(page)
    // 代码事实就绪：④ 段的结构节出现（没有代码事实时该节也渲染、只给原因，不阻塞）
    await page.waitForSelector('[data-sec="boundary.structure"]', { timeout: 20_000 })
    const m = await measureStable(page)
    console.log(`PANEL_BASELINE ${c.project} module rows=${m.rows} readable=${m.firstScreenReadable} gapPx=${m.gapPx} boundaryBottom=${m.boundaryBottom}`)
    expect(m.rows).toBeGreaterThan(0)
  })

  test(`G15 基线 · ${c.project} 系统面板：常显行数与首屏可读`, async ({ page }) => {
    await openDesk(page, `/p/${c.project}`)
    await waitSettled(page)
    await page.waitForSelector('[data-sec="boundary.top"]', { timeout: 20_000 })
    const m = await measureStable(page)
    console.log(`PANEL_BASELINE ${c.project} system rows=${m.rows} readable=${m.firstScreenReadable} gapPx=${m.gapPx} boundaryBottom=${m.boundaryBottom}`)
    expect(m.rows).toBeGreaterThan(0)
  })
}

/*
 * G15 基线（2026-10-28，G11 波 0b 原型落地后实测，1700×1100、缺省面板宽；只记录、不断言上限）：
 *
 * | 项目 | 对象 | 常显行数 | 首屏可读 | 缺口 px |
 * |---|---|---|---|---|
 * | h5p-arch-desk | 模块 present.canvas | 29 | 否 | 388 |
 * | h5p-arch-desk | 系统 | 27 | 是 | 0 |
 * | h5player | 模块 app.solution | 41 | 否 | 1926 |
 * | h5player | 系统 | 19 | 是 | 0 |
 * | media-web-player | 模块 kit.kernel | 34 | 否 | 924 |
 * | media-web-player | 系统 | 19 | 是 | 0 |
 */
