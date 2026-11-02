/**
 * G14（L47）、ADR-0058：图例按上下文显示的 E2E 守护。
 * - 行数上限：三项目 × 三视角、脚注展开的图例行数不高于基线（G14 只许隐藏行、不许净增；基线 = 第十八轮走查重组后的实测 + 2 行余量）。
 *   结构视角等代码事实就绪再量（形态行出现），交互视角等代码事实就绪（代码事实开关可用、脚注有缺段行）——缺了它量到的是加载中途的值。
 * - 行为断言（h5p-arch-desk）：运行视角没有「线型」一行（运行视角没有 K9 叠加）；脚注「临时可见」三视角都列选中与变淡
 *   （不随出现显隐）；结构视角的「表面 W」行随本层角标出现在脚注（L20①，出现集合与画布同一口径）。
 */
import { expect, test, type Page } from '@playwright/test'
import { openDesk, waitSettled } from './helpers'

test.use({ viewport: { width: 1700, height: 1100 } })

/** 各视角的行数上限（重组后实测 + 2 行余量，见文件头） */
const CAPS = { 交互: 20, 结构: 26, 运行: 18 } as const

/** 行 = 图例内容行：.item（含开关行与脚注的行）、读法行（粗细 / 箭头 / 线型 / 节点）、小节标签；不含节标题与脚注按钮 */
const COUNT = `(() => {
  const body = document.querySelector('.display .body')
  if (!body) return -1
  return body.querySelectorAll('.item').length + body.querySelectorAll('.reading-row').length + body.querySelectorAll('.section-label').length
})()`

/** 展开图例与脚注，等代码事实就绪，返回全展开的行数 */
async function legendRows(page: Page, view: keyof typeof CAPS): Promise<number> {
  const panel = page.locator('.display')
  await expect(panel.locator('.head-btn')).toBeVisible()
  if ((await panel.locator('.head-btn').getAttribute('aria-expanded')) !== 'true') await panel.locator('.head-btn').click()
  // 代码事实就绪的标记：结构视角的形态行 / 交互视角可用的代码事实开关
  if (view === '结构') await page.waitForSelector('.display [data-form]:visible', { timeout: 20_000 })
  if (view === '交互') await page.waitForSelector('.display [data-testid="toggle-facts"]:not([disabled])', { timeout: 20_000 })
  const foot = panel.locator('[data-testid="legend-temp"]')
  if ((await foot.getAttribute('aria-expanded')) !== 'true') await foot.click()
  if (view === '交互') await page.waitForSelector('.display [data-testid="carrier-legend"]', { timeout: 20_000 })
  await expect.poll(() => page.evaluate(COUNT), { intervals: [200] }).toBeGreaterThan(0)
  return page.evaluate(COUNT)
}

for (const project of ['h5p-arch-desk', 'h5player', 'media-web-player']) {
  for (const [name, q] of [
    ['交互', ''],
    ['结构', '?v=s'],
    ['运行', '?sc=sc.first'],
  ] as const) {
    test(`图例行数不高于基线 · ${project} · ${name}`, async ({ page }) => {
      await openDesk(page, `/p/${project}${q}`)
      await waitSettled(page)
      const n = await legendRows(page, name)
      console.log(`LEGEND_ROWS ${project} ${name} rows=${n} (cap ${CAPS[name]})`)
      expect(n).toBeLessThanOrEqual(CAPS[name])
    })
  }
}

test('G14 行为（h5p-arch-desk）：回放中不列「线型」行；脚注三视角都列选中与变淡；结构视角「表面 W」随角标出现在脚注', async ({ page }) => {
  // 回放中：没有 K9 叠加（lf 为 null）→ 线型行不列；选中与变淡在脚注常列
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  const panel = page.locator('.display')
  if ((await panel.locator('.head-btn').getAttribute('aria-expanded')) !== 'true') await panel.locator('.head-btn').click()
  await expect(panel.getByTestId('legend-linestyle')).toHaveCount(0)
  await expect(panel.getByTestId('legend-temp')).toContainText(/回放 \/ 选中时另有 \d+ 种记号/)
  await panel.getByTestId('legend-temp').click()
  const foot = panel.locator('[aria-label="临时可见的记号"]')
  await expect(foot).toContainText('选中：强调色窄晕')
  await expect(foot).toContainText('变淡：不在焦点内的节点与线降低不透明度')
  await expect(foot).not.toContainText('虚线 = 依赖')
  // 结构视角：代码事实就绪后，「表面 W」行随本层角标出现在脚注（h5p 根层有带 W 的节点）
  await openDesk(page, '/p/h5p-arch-desk?v=s')
  await waitSettled(page)
  await legendRows(page, '结构')
  await expect(panel.locator('[aria-label="临时可见的记号"]')).toContainText('表面 W')
})
