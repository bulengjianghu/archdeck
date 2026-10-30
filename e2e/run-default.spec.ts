/** 运行视角默认态（W-1、W-2）：打开场景时导航树收起、退出恢复，按视角记在本地；「显示 ▾」旁的摘要给出交互关系的显示方式（L49） */
import { expect, test } from '@playwright/test'
import { openDesk } from './helpers'

test('打开场景导航树自动收起，退出恢复；运行视角里展开后下次进入仍展开', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const nav = page.locator('.nav-area')
  await expect(nav).toBeVisible()
  await page.goto('./#/p/h5p-arch-desk?sc=sc.open-and-play')
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
  await expect(nav).toBeHidden()
  // 运行视角「显示 ▾」旁的摘要（L49）
  await expect(page.getByTestId('display-summary')).toHaveText('交互关系：隐藏')
  await page.getByRole('button', { name: '展开导航树' }).click()
  await expect(nav).toBeVisible()
  await page.goto('./#/p/h5p-arch-desk')
  await expect(nav).toBeVisible()
  await page.goto('./#/p/h5p-arch-desk?sc=sc.open-and-play')
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
  await expect(nav).toBeVisible()
})
