/**
 * G14（L47）：图例按上下文显示的 E2E 守护。
 * - 行数上限：三项目 × 三视角全展开的图例行数不高于固定词表全列的基线（G14 只许隐藏行、不许净增；上限 = 波 2 全列基线
 *   交互 31 / 结构 40 / 运行 31 加 2 行「临时可见」小节标签的余量）。结构视角等代码事实就绪再量，缺了它量到的是加载中途的值。
 * - 行为断言（h5p-arch-desk）：运行视角没有「虚线 = 依赖」行（运行视角没有 K9 叠加）；共享组的「临时可见」小节三视角常列
 *   （选中与变淡不随出现显隐）；结构视角的「表面 W」行随本层角标出现（L20①，出现集合与画布同一口径）。
 */
import { expect, test, type Page } from '@playwright/test'
import { openDesk, waitSettled } from './helpers'

test.use({ viewport: { width: 1700, height: 1100 } })

/** 各视角的行数上限（固定词表全列基线 + 2 行小节标签余量，见文件头） */
const CAPS = { 交互: 33, 结构: 42, 运行: 33 } as const

/** 行 = 图例内容行：.item、三问 li、四修饰行、小节标签（不含组标题） */
const COUNT = `(() => {
  const body = document.querySelector('.display .body')
  if (!body) return -1
  return body.querySelectorAll('.item').length + body.querySelectorAll('.questions li').length + body.querySelectorAll('.reading-row').length + body.querySelectorAll('.section-label').length
})()`

/** 展开面板与全部组，等代码事实就绪（结构视角等束说明、交互视角等标签词），返回全展开的行数 */
async function legendRows(page: Page, view: keyof typeof CAPS): Promise<number> {
  const panel = page.locator('.display')
  await expect(panel.locator('.head-btn')).toBeVisible()
  if ((await panel.locator('.head-btn').getAttribute('aria-expanded')) !== 'true') await panel.locator('.head-btn').click()
  for (const btn of await panel.locator('.group-btn[aria-expanded="false"]').all()) await btn.click()
  // 代码事实就绪的标记：结构视角的束说明 / 交互视角的缺段（临时可见）行——组已展开，就绪即出现
  if (view === '结构') await page.waitForSelector('.display [data-testid="bundle-note"]', { timeout: 20_000 })
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
    test(`图例行数不高于全列基线 · ${project} · ${name}`, async ({ page }) => {
      await openDesk(page, `/p/${project}${q}`)
      await waitSettled(page)
      const n = await legendRows(page, name)
      console.log(`LEGEND_ROWS ${project} ${name} rows=${n} (cap ${CAPS[name]})`)
      expect(n).toBeLessThanOrEqual(CAPS[name])
    })
  }
}

test('G14 行为（h5p-arch-desk）：回放中不列「虚线 = 依赖」；共享组「临时可见」常列；结构视角「表面 W」随角标出现', async ({ page }) => {
  // 回放中：没有 K9 叠加（lf 为 null）→ 虚线行不列；选中与变淡在「临时可见」常列
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  const panel = page.locator('.display')
  if ((await panel.locator('.head-btn').getAttribute('aria-expanded')) !== 'true') await panel.locator('.head-btn').click()
  const sharedBtn = panel.locator('.group-btn', { hasText: '共享' })
  if ((await sharedBtn.getAttribute('aria-expanded')) !== 'true') await sharedBtn.click()
  const shared = panel.locator('[aria-label="共享通道"]')
  await expect(shared).toContainText('临时可见 · 选中 / 悬停时出现')
  await expect(shared).toContainText('选中：强调色窄晕')
  await expect(shared).not.toContainText('虚线 = 依赖')
  // 结构视角：代码事实就绪后，「表面 W」行随本层角标出现（h5p 根层有带 W 的节点）
  await openDesk(page, '/p/h5p-arch-desk?v=s')
  await waitSettled(page)
  await legendRows(page, '结构')
  await expect(panel.locator('.body')).toContainText('表面 W')
})
