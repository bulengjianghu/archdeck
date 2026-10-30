/** 经由上层关系（§6.9、ADR-0014）：已绑定关系而本层没有视图边的消息画成关系类型色的临时线，与「未建模」区分；面板可定位到那条关系 */
import { expect, test } from '@playwright/test'
import { openCheckList, openDesk, query } from './helpers'

const BEGIN = '/p/h5player?level=infra.framework&sc=sc.switch-transaction&step=sc.switch-transaction%23begin'

test('beginXxxModelSwitch()：交互图画类型色实线临时线、标签位写「经上层」（ADR-0035）、时序图标「经由上层关系」；面板定位到上层关系', async ({ page }) => {
  await openDesk(page, BEGIN)
  const line = page.locator('.vue-flow__edge[data-id^="upper:"]')
  await expect(line).toHaveCount(1)
  await expect(line).toContainText('经上层')
  // L18：是一次交互——实线（不是依赖的虚线）
  await expect(line.locator('path.vue-flow__edge-path')).toHaveCSS('stroke-dasharray', 'none')
  await expect(line.locator('.edge-label-pill')).toBeAttached()
  await expect(page.locator('.vue-flow__edge[data-id^="unmodeled:"]')).toHaveCount(0)
  await expect(page.locator('.msg.selected .upper-tag')).toContainText('经由上层关系')
  await expect(page.locator('.msg .tag')).toHaveCount(0)

  // PC-10：端点与本层投影是步骤核对卡的清单
  await openCheckList(page, 'evidence.ends')
  await expect(page.locator('.panel')).toContainText('对应关系建在上层')
  await page.locator('.panel button', { hasText: '定位到这条关系' }).click()
  await expect.poll(() => query(page).get('sel')).toBe('r:rel.solution.stage-swap-framework')
  expect(query(page).get('level')).not.toBe('infra.framework')
})

test('命令执行的 pre / post hook：描述补上 Framework 回调 lifecycle 的关系后落在视图边上，不再是「未建模」', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra.framework&sc=sc.command&alt=1&step=sc.command%23hook')
  await expect(page.locator('.msg.selected')).toContainText('pre / post hook')
  await expect(page.locator('.vue-flow__edge[data-id^="unmodeled:"]')).toHaveCount(0)
  await expect(page.locator('.msg .tag')).toHaveCount(0)
})
