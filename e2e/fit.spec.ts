/** V14（ADR-0039 修订 2）：「显示」面板展开时「适应」只用面板左侧的区域；展开、收起即重新适应 */
import { expect, test, type Page } from '@playwright/test'
import { collapseDisplay, openDesk, settleCanvas } from './helpers'

/** 画布上全部模块类节点的最右边（屏幕坐标） */
const contentRight = (page: Page) =>
  page
    .locator('.vue-flow__node-module, .vue-flow__node-core, .vue-flow__node-boundary, .vue-flow__node-actor, .vue-flow__node-band')
    .evaluateAll(els => Math.max(...els.map(n => n.getBoundingClientRect().right)))

const panelLeft = (page: Page) => page.locator('.display').evaluate(el => el.getBoundingClientRect().left)

test('V14：面板展开时内容全在面板左侧；收起后重新适应、用整块画布；再展开又退回面板左侧', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=present.panel')
  await expect(page.locator('.display .head-btn')).toHaveAttribute('aria-expanded', 'true')
  await settleCanvas(page)
  const left = await panelLeft(page)
  expect(await contentRight(page)).toBeLessThanOrEqual(left)

  await collapseDisplay(page)
  // 收起后可用区域变宽：内容右边越过原来的面板左边
  await expect.poll(() => contentRight(page)).toBeGreaterThan(left)

  await page.locator('.display .head-btn').click()
  await settleCanvas(page)
  await expect.poll(async () => (await contentRight(page)) <= (await panelLeft(page))).toBe(true)
})

test('V14：「适应」按钮同样只用面板左侧', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra')
  await settleCanvas(page)
  await page.getByRole('button', { name: '＋' }).click()
  await page.getByRole('button', { name: '＋' }).click()
  await page.getByTitle('适应画布').click()
  await settleCanvas(page)
  expect(await contentRight(page)).toBeLessThanOrEqual(await panelLeft(page))
})
