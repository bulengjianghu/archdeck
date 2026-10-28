/**
 * G15（L46）：面板测量装置（不变式 8「肉眼守不住的几何纪律交给机器守」的面板版，00-candidates §4）。
 * 对每个项目 × 每类对象（模块选一个内容丰富的：h5p present.canvas、h5player app.solution、media kit.kernel；系统 = 根层面板）
 * 测两个数并**断言常显行数上限**（上限为波 2 铺开 + 折叠后的基线加合理余量，数值议、负责人定稿）：
 *
 * - 常显行数：面板静息态（不滚动、不展开）占用的行数。口径：① 头部算 2 行（标题行 + 徽标行），设计说明算 1 行（出现时）；
 *   每一节（含折叠节）的标题算 1 行；非折叠节的节体内每个一级行块（.section 的直接子元素，h3 之外）各算 1 行（块内不再展开，如子模块清单整块 1 行）；
 *   出处 footer 算 1 行。
 * - 首屏可读：1700×1100 视口、缺省面板宽，不滚动、不展开时 ①–④ 段是否全部在视口内（③ 无异常时不存在，按出现的段计）；
 *   输出布尔与缺口像素（④ 段最后一节的底边超出视口下沿多少 px，不缺为 0）。
 *
 * 上限（2026-10-28 波 2 实测后定，议——负责人定稿；模块面板在结构视角、系统面板在代码事实就绪后的静息态测量）：
 * - 模块面板 ≤ 36 行（h5p 基线 32 + 4、media 34 + 2；依据：① 2 + 设计说明 1 + ② 1–2 + ③ 0–3 + ④ 各节常显（出边入边已汇总、表面折叠带计数）+ ⑤ 折叠标题 ~9 + footer 1）
 * - h5player 模块面板（最重）暂挂 ≤ 44（基线 41 + 3）：② 长文与 ④ 子模块清单仍溢出，缺口见文件尾注，波 3 处理
 * - 系统面板按项目 ≤ 33（h5p、media 基线 31 + 2）/ ≤ 39（h5player 基线 37 + 2；治理明细的违规组多一组）：
 *   依据：① 2 + ② 简介 1 + ③ 治理类 3 行 + ④ 分层 1 + ⑤ 生成来源 3、意图 2、健康度 6（G12 分组后）、治理明细各节（③ 的跳转落点）、折叠标题与 footer
 * 系统面板 ①–④ 全部在首屏内（三项目实测 boundaryBottom ≤ 841 < 1100），一并断言。行数只许从常显挪进折叠、不许净增（L46）。
 */
import { expect, test, type Page } from '@playwright/test'
import { openDesk, waitSettled } from './helpers'

test.use({ viewport: { width: 1700, height: 1100 } })

const CASES = [
  { project: 'h5p-arch-desk', module: 'present.canvas', level: 'present', moduleCap: 36, systemCap: 33 },
  { project: 'h5player', module: 'app.solution', level: 'app', moduleCap: 44, systemCap: 39 },
  { project: 'media-web-player', module: 'kit.kernel', level: 'kit', moduleCap: 36, systemCap: 33 },
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
  test(`G15 上限（L46）· ${c.project} 模块面板（${c.module}，结构视角）：常显行数 ≤ ${c.moduleCap}`, async ({ page }) => {
    await openDesk(page, `/p/${c.project}?level=${c.level}&sel=m:${c.module}&v=s`)
    await waitSettled(page)
    // 代码事实就绪：④ 段的结构节出现（没有代码事实时该节也渲染、只给原因，不阻塞）
    await page.waitForSelector('[data-sec="boundary.structure"]', { timeout: 20_000 })
    const m = await measureStable(page)
    console.log(
      `PANEL_BASELINE ${c.project} module rows=${m.rows} cap=${c.moduleCap} readable=${m.firstScreenReadable} gapPx=${m.gapPx} boundaryBottom=${m.boundaryBottom}`,
    )
    // 行数只许从常显挪进折叠、不许净增（L46）；h5player 的 44 是最重对象的暂挂豁免（② 长文与 ④ 子模块清单，波 3 收敛）
    expect(m.rows).toBeLessThanOrEqual(c.moduleCap)
  })

  test(`G15 上限（L46）· ${c.project} 系统面板：常显行数 ≤ ${c.systemCap}`, async ({ page }) => {
    await openDesk(page, `/p/${c.project}`)
    await waitSettled(page)
    await page.waitForSelector('[data-sec="boundary.top"]', { timeout: 20_000 })
    // 代码事实就绪再量：健康度的治理组（fold-gov）随治理报告出现；缺了它量到的是加载中途的假低值（G9）
    await page.waitForSelector('.fold-gov', { timeout: 20_000 })
    const m = await measureStable(page)
    console.log(
      `PANEL_BASELINE ${c.project} system rows=${m.rows} cap=${c.systemCap} readable=${m.firstScreenReadable} gapPx=${m.gapPx} boundaryBottom=${m.boundaryBottom}`,
    )
    expect(m.rows).toBeLessThanOrEqual(c.systemCap)
    // 系统面板 ①–④ 全部在首屏内（三项目实测 boundaryBottom ≤ 841 < 1100）
    expect(m.firstScreenReadable).toBe(true)
  })
}

/*
 * G15 基线（2026-10-28，波 2 · G11 铺开 + G12 二级折叠落地后实测，1700×1100、缺省面板宽；上限为基线 + 余量，议——负责人定稿）：
 * 系统面板在代码事实就绪后量（等 .fold-gov）——波 0b 基线里系统面板 19 / 19 / 27 是治理报告加载中途的假低值，作废。
 *
 * | 项目 | 对象 | 常显行数（基线） | 上限 | 首屏可读（①–④） | ④ 底边 px |
 * |---|---|---|---|---|---|
 * | h5p-arch-desk | 模块 present.canvas | 32 | 36 | 否 | 1540 |
 * | h5p-arch-desk | 系统 | 31 | 33 | 是 | 771 |
 * | h5player | 模块 app.solution | 41 | 44（暂挂，波 3） | 否 | 2762 |
 * | h5player | 系统 | 37 | 39 | 是 | 704 |
 * | media-web-player | 模块 kit.kernel | 34 | 36 | 否 | 2024 |
 * | media-web-player | 系统 | 31 | 33 | 是 | 841 |
 *
 * 模块面板相对波 0b 的行数变化（29→32 / 41→41 / 34→34）来自描述与代码事实推进（源码树前进 17+ 提交，表面元素与 ③ 信号变多），
 * 不是骨架回退；系统面板 27→31（h5p）同样主要是治理明细就绪后的真值。
 *
 * h5player 模块面板剩余缺口（波 3 建议，不强做）：首屏缺口 1663 px。量化：② 说明长文（app.solution 的职责多行）与
 * ④ 子模块清单（app.solution 子模块最多，每行块 1 行但块数多）占大头；可做的收敛——② 长文超 N 行折叠带计数、
 * ④ 子模块清单只列前 M 个其余收「+N」（折叠必有计数）、结构指标与影响面（ModuleStructure）的闭包明细再折叠一层。
 */
