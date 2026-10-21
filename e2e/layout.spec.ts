/** 分屏与源码预览（§6.3、§6.4）：分屏方向切换并在刷新后保持；选中文件时副栏预览源码 */
import { expect, test } from '@playwright/test'
import { openDesk, query } from './helpers'

test('运行视角默认左右分屏；切换为上下后刷新仍保持', async ({ page }) => {
  await openDesk(page, '/p/h5player?sc=sc.command')
  await expect(page.locator('.split.row')).toBeVisible()
  await page.locator('.aside .dir').click()
  await expect(page.locator('.split.column')).toBeVisible()
  await page.reload()
  await expect(page.locator('.split.column')).toBeVisible()
})

test('文件页签中选中文件：地址带 sel=f:，副栏切到源代码并显示带行号的源码', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await page.getByRole('tab', { name: '文件' }).click()
  const src = page.locator('.row.dir[data-dir="src"]')
  await expect(src).toBeVisible()
  if ((await page.locator('.row.file[data-path="src/main.ts"]').count()) === 0) await src.click()
  await page.locator('.row.file[data-path="src/main.ts"]').click()
  expect(query(page).get('sel')).toBe('f:src/main.ts')
  await expect(page.locator('.aside .tab.on')).toContainText('main.ts')
  await expect(page.locator('.aside .content')).toContainText('createApp')
})
