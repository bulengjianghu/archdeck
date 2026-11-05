/** 运行视角默认态（W-1、W-2）：打开场景时导航树收起、退出恢复，按视角记在本地；「显示 ▾」旁的摘要给出交互关系的显示方式（L49） */
import { expect, test } from '@playwright/test'
import { openDesk } from './helpers'

test('第二十轮 §4：导航树是浮层抽屉、两个视角都缺省收起，展开状态按视角记在本地（W-1 改写）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const nav = page.locator('.nav-area')
  await expect(nav).toBeHidden()
  await page.goto('./#/p/h5p-arch-desk?sc=sc.open-and-play')
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
  await expect(nav).toBeHidden()
  // 运行视角「显示 ▾」旁的摘要（L49）
  await expect(page.getByTestId('display-summary')).toHaveCount(0)
  await page.getByRole('button', { name: '导航树', exact: true }).click()
  await expect(nav).toBeVisible()
  // 结构视角展开过、运行视角收起：回到运行仍收起；在运行里展开过，下次进运行仍展开
  await page.goto('./#/p/h5p-arch-desk')
  await expect(nav).toBeHidden()
  await page.goto('./#/p/h5p-arch-desk?sc=sc.open-and-play')
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
  await expect(nav).toBeVisible()
})
