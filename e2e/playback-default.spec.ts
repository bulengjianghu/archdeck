/** 回放默认态（LY-3、LY-16）：侧栏只由人开合，不随进出场景变（进入回放只换到「场景」页）；「显示 ▾」旁没有摘要（L49） */
import { expect, test } from '@playwright/test'
import { closeNav, openDesk, openSidebar, rail, sidebar } from './helpers'

test('LY-3、LY-16：侧栏只由人开合——进出场景都不自动开合；进入回放换到「场景」页、先列步骤', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  // 1440 宽、没有本机记忆：缺省展开
  await expect(sidebar(page)).toBeVisible()
  await page.goto('./#/p/h5p-arch-desk?sc=sc.open-and-play')
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
  await expect(sidebar(page)).toBeVisible()
  await expect(rail(page).locator('[data-rail="scenes"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(sidebar(page).locator('.step-tree')).toBeVisible()
  await expect(page.getByTestId('display-summary')).toHaveCount(0)
  // 人收起后：退出场景、再进场景都保持收起
  await closeNav(page)
  await page.goto('./#/p/h5p-arch-desk')
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
  await expect(sidebar(page)).toHaveCount(0)
  await page.goto('./#/p/h5p-arch-desk?sc=sc.open-and-play')
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
  await expect(sidebar(page)).toHaveCount(0)
  await openSidebar(page)
  await expect(sidebar(page).locator('.step-tree')).toBeVisible()
})
