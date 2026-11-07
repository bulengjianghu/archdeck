/** 回放默认态（LY-16）：导航浮层（波 1 过渡）缺省收起、只由人开合，不随进出场景变；「显示 ▾」旁没有摘要（L49） */
import { expect, test } from '@playwright/test'
import { openDesk } from './helpers'

test('LY-16：导航浮层缺省收起、只由人开合——进出场景都不自动开合，展开后进场景仍展开', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const nav = page.locator('.nav-area')
  await expect(nav).toBeHidden()
  await page.goto('./#/p/h5p-arch-desk?sc=sc.open-and-play')
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
  await expect(nav).toBeHidden()
  await expect(page.getByTestId('display-summary')).toHaveCount(0)
  await page.getByRole('button', { name: '导航树', exact: true }).click()
  await expect(nav).toBeVisible()
  // 退出场景、再进场景：保持人开的状态
  await page.goto('./#/p/h5p-arch-desk')
  await expect(nav).toBeVisible()
  await page.goto('./#/p/h5p-arch-desk?sc=sc.open-and-play')
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
  await expect(nav).toBeVisible()
})
