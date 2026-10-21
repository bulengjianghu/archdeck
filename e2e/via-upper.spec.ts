/** 经由上层关系（§6.9、ADR-0014）：已绑定关系而本层没有视图边的消息画成关系类型色的临时线，与「未建模」区分；面板可定位到那条关系 */
import { expect, test } from '@playwright/test'
import { openDesk, query } from './helpers'

const BEGIN = '/p/h5player?level=infra.framework&sc=sc.switch-transaction&step=sc.switch-transaction%23begin'

test('beginXxxModelSwitch()：结构图画「经由上层」实线、时序图标「经由上层关系」；面板定位到上层关系', async ({ page }) => {
  await openDesk(page, BEGIN)
  const line = page.locator('.vue-flow__edge[data-id^="upper:"]')
  await expect(line).toHaveCount(1)
  await expect(line).toContainText('经由上层')
  await expect(line.locator('path.vue-flow__edge-path')).toHaveCSS('stroke-dasharray', 'none')
  await expect(page.locator('.vue-flow__edge[data-id^="unmodeled:"]')).toHaveCount(0)
  await expect(page.locator('.msg.selected .upper-tag')).toContainText('经由上层关系')
  await expect(page.locator('.msg .tag')).toHaveCount(0)

  await expect(page.locator('.panel')).toContainText('对应关系建在上层')
  await page.locator('.panel button', { hasText: '定位到这条关系' }).click()
  await expect.poll(() => query(page).get('sel')).toBe('r:rel.solution.stage-swap-framework')
  expect(query(page).get('level')).not.toBe('infra.framework')
})

test('命令执行的 pre / post hook：没有绑定关系，仍为红色虚线「未建模」', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra.framework&sc=sc.command&alt=1&step=sc.command%23hook')
  await expect(page.locator('.vue-flow__edge[data-id^="unmodeled:"]')).toHaveCount(1)
  await expect(page.locator('.msg.selected .tag')).toContainText('结构中未建模')
})
