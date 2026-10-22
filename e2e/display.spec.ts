/** 「显示」面板（W-2、ADR-0017）：显示设置与图例合一；按视角只出现能用的开关，折叠时摘要列出非默认设置 */
import { expect, test } from '@playwright/test'
import { openDesk } from './helpers'

test('结构视角：关系类型筛选与边界节点开关在面板里，折叠后摘要列出', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const panel = page.getByRole('region', { name: '显示' })
  const depends = panel.getByRole('button', { name: /依赖/ })
  await depends.click()
  await expect(depends).toHaveAttribute('aria-pressed', 'false')
  await panel.getByLabel('边界节点').uncheck()
  await panel.getByRole('button', { name: /^显示/ }).click()
  await expect(panel.getByRole('button', { name: /^显示/ })).toContainText('隐藏 1 类关系 · 无边界节点')
  // 顶部工具栏不再有显示开关
  await expect(page.locator('.toolbar input[type=checkbox]')).toHaveCount(0)
})

test('运行视角：静态关系显示方式在面板里，结构类开关不出现', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  const panel = page.getByRole('region', { name: '显示' })
  await panel.getByRole('button', { name: /^显示/ }).click()
  await expect(panel.getByLabel('边界节点')).toHaveCount(0)
  await expect(panel.getByRole('group', { name: '关系类型筛选' })).toHaveCount(0)
  await panel.getByRole('button', { name: '淡显' }).click()
  await expect(panel.getByRole('button', { name: '淡显' })).toHaveAttribute('aria-pressed', 'true')
  await panel.getByRole('button', { name: /^显示/ }).click()
  await expect(panel.getByRole('button', { name: /^显示/ })).toContainText('静态关系：淡显')
})
