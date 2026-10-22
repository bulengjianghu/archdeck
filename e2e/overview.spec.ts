/** 入门页与分层总览（W-10、O6、O7、DV-6、DV-9）：「?」打开「怎么读这张图」；带内 +N 单击临时展开、不改层次；版本切换里已归档的设计单独一组；设计面板链到 ADR */
import { expect, test } from '@playwright/test'
import { openDesk, query } from './helpers'

test('顶栏「?」打开「怎么读这张图」：结构 / 运行 / 对照与治理三组，Esc 关闭', async ({ page }) => {
  await openDesk(page, '/p/h5player')
  await page.getByRole('button', { name: '怎么读这张图' }).click()
  const dialog = page.getByRole('dialog', { name: '怎么读这张图' })
  await expect(dialog.locator('h3')).toHaveText(['结构', '运行', '对照与治理'])
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  // Esc 只关掉入门页，不返回上级
  await expect(page).toHaveURL(/#\/p\/h5player/)
})

test('O6：单击带内 +N 临时展开非核心模块，层次与地址不变；再单击收起', async ({ page }) => {
  await openDesk(page, '/p/h5player')
  const cores = page.locator('.vue-flow__node-core')
  const before = await cores.count()
  const more = page.locator('.vue-flow__node-more').first()
  await more.click()
  await expect.poll(() => cores.count()).toBeGreaterThan(before)
  expect(query(page).get('level')).toBeNull()
  await expect(page.locator('.vue-flow__node-more .more.expanded')).toHaveCount(1)
  await page.locator('.vue-flow__node-more:has(.more.expanded)').click()
  await expect.poll(() => cores.count()).toBe(before)
})

test('DV-6、DV-9：已归档的设计在版本切换里单独一组；设计面板的 ADR 链接在副栏预览', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await expect(page.locator('select[aria-label="切换版本"] optgroup[label^="已归档"] option').first()).toContainText('二期 · 动态视角')
  await openDesk(page, '/p/h5p-arch-desk/d/phase2-dynamic/r4')
  await page.locator('.design-section .adr button').click()
  await expect(page.locator('.source-view')).toContainText('ADR-0003')
})
