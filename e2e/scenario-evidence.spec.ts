/** 场景证据（S15、D-20）：场景面板的「证据」一节列出文件并可在副栏预览；场景列表给有证据的场景标 ✓ */
import { expect, test } from '@playwright/test'
import { openDesk } from './helpers'

test('打开自身的场景：面板有「证据」一节，单击文件在副栏预览源码；场景列表标 ✓', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  const section = page.locator('.scenario-panel .section').filter({ has: page.locator('h3', { hasText: '证据' }) })
  await expect(section).toBeVisible()
  await expect(section.getByRole('button', { name: 'tests/acceptance/run-perspective.test.ts' })).toBeVisible()
  await expect(section.locator('.missing')).toHaveCount(0)
  await section.getByRole('button', { name: 'e2e/run-default.spec.ts' }).click()
  await expect(page.locator('.aside .tab.on')).toContainText('run-default.spec.ts')
  await expect(page.locator('.source-view')).toContainText('打开场景导航树自动收起')
  await page.getByRole('button', { name: /^运行：/ }).click()
  await expect(page.locator('.scenario-list .item .evidence')).toHaveCount(1)
})
