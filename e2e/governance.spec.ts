/** 架构治理（§6.10 第 5、6 条）：开启「代码事实」，关系边带证实标记，单击代码依赖叠加线看证据；根层面板有架构治理 */
import { expect, test } from '@playwright/test'
import { openDesk, query } from './helpers'

test('开启代码事实：关系边带 ✓，单击叠加线选中它并显示代码依赖面板', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await expect(page.locator('.panel')).toContainText('架构治理')
  await expect(page.locator('.panel')).toContainText(/已证实 \d+/)

  const toggle = page.locator('label.facts input')
  await expect(toggle).toBeEnabled()
  await toggle.check()
  await expect(page.locator('.vue-flow__edge-text', { hasText: '✓' }).first()).toBeVisible()

  const overlay = page.locator('.vue-flow__edge-text', { hasText: '未描述' }).first()
  await expect(overlay).toBeVisible()
  // 叠加线的标签浮在边上，Playwright 的「稳定」判定会一直等待，这里直接单击
  await overlay.click({ force: true })
  await expect.poll(() => query(page).get('sel')).toMatch(/^d:.+->.+$/)
  await expect(page.locator('.dep-panel')).toContainText('模块依赖')
})

test('运行视角下「代码事实」开关不可用', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await expect(page.locator('label.facts input')).toBeDisabled()
})
