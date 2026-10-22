/** 「显示」面板（W-2、ADR-0017）：先设置后图例；按视角只出现能用的开关，折叠时摘要列出非默认设置；运行视角默认只展开「回放」；时序图图例在副栏「?」 */
import { expect, test } from '@playwright/test'
import { openDesk } from './helpers'

test('结构视角：关系类型筛选与边界节点开关在面板里，折叠后摘要列出', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const panel = page.getByRole('region', { name: '显示' })
  // L10：图例按通道说明线型、箭头与线宽
  await expect(panel).toContainText('箭头实心 = 同步，空心 = 异步')
  await expect(panel).toContainText('线越粗 = 聚合的关系越多')
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
  // 运行视角默认只展开「回放」
  await expect(panel.getByRole('button', { name: /关系/ })).toHaveAttribute('aria-expanded', 'false')
  await expect(panel).toContainText('当前步骤（沿消息方向流动）')
  await expect(panel).not.toContainText('调用（控制权转移）')
  await panel.getByRole('button', { name: '淡显' }).click()
  await expect(panel.getByRole('button', { name: '淡显' })).toHaveAttribute('aria-pressed', 'true')
  await panel.getByRole('button', { name: /^显示/ }).click()
  await expect(panel.getByRole('button', { name: /^显示/ })).toContainText('静态关系：淡显')
})

test('时序图图例在副栏标题栏的「?」里', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await page.getByRole('button', { name: '时序图图例' }).click()
  await expect(page.getByRole('note', { name: '时序图图例' })).toContainText('同步调用')
  await expect(page.getByRole('region', { name: '显示' })).not.toContainText('同步')
})
