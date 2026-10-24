/**
 * 架构治理（§6.10 第 5、6 条）：开启「代码事实」，只标异常——未证实的关系边为虚线并标 ?、已证实的不标；单击代码依赖叠加线看证据；根层面板有架构治理。
 * 本项目的描述已无未解释的交互、根层也没有未证实的边（经 HTTP 等的写了 via，K5b），? 与叠加线用 h5player 验证（源码在本地是前提，G1，不设跳过）。
 * 两个项目的未解释的交互都已为 0（ADR-0026），h5player 的违规都在基线内（不画线）：叠加线用例拦截事实端点去掉基线，让违规成为「无基线的全部违规」画出来（K9）。
 */
import { expect, test } from '@playwright/test'
import { openDesk, query } from './helpers'

test('开启代码事实：未证实的边标 ?，已证实的不标 ✓（K9、L10）', async ({ page }) => {
  await openDesk(page, '/p/h5player')
  await expect(page.locator('.panel')).toContainText('架构治理')
  await expect(page.locator('.panel')).toContainText(/已证实 \d+/)
  const toggle = page.locator('label.facts input')
  await expect(toggle).toBeEnabled()
  await toggle.check()
  await expect(page.locator('.edge-label-warn .vue-flow__edge-text', { hasText: '?' }).first()).toBeVisible()
  await expect(page.locator('.vue-flow__edge-text', { hasText: '✓' })).toHaveCount(0)
})

test('K5a：Projector 文件内概念子模块之间的关系，面板标「概念拆分，同文件」', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=model.projector&sel=r:rel.ad.overview-endpoints')
  await expect(page.locator('.panel')).toContainText('不判定：概念拆分，同文件')
})

test('h5player：没有基线时违规画成叠加线；单击叠加线选中它并显示代码依赖面板', async ({ page }) => {
  await page.route('**/source/h5player/facts.json', async route => {
    const res = await route.fetch()
    await route.fulfill({ response: res, json: { ...(await res.json()), baseline: null } })
  })
  await openDesk(page, '/p/h5player')
  await expect(page.locator('.panel')).toContainText('架构治理')
  await expect(page.locator('.panel')).toContainText(/已证实 \d+/)

  const toggle = page.locator('label.facts input')
  await expect(toggle).toBeEnabled()
  await toggle.check()
  await expect(page.locator('.vue-flow__edge-text', { hasText: '✓' })).toHaveCount(0)

  // 根层的违规都落在已有的层间边上（只加红晕）；Framework 层有没有关系边的违规（外部的 app → kernel），画成叠加线
  await openDesk(page, '/p/h5player?level=infra.framework')
  const overlay = page.locator('.vue-flow__edge-text', { hasText: '违规' }).first()
  await expect(overlay).toBeVisible()
  // 叠加线的标签浮在边上，Playwright 的「稳定」判定会一直等待；h5player 根层节点密集，按坐标单击会落到节点上，这里直接在标签上派发单击
  await overlay.dispatchEvent('click')
  await expect.poll(() => query(page).get('sel')).toMatch(/^d:.+->.+$/)
  await expect(page.locator('.dep-panel')).toContainText('模块依赖')
})

test('运行视角下「显示」面板不出现「代码事实」开关（L9）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await page.getByRole('button', { name: /^显示/ }).click()
  await expect(page.getByRole('region', { name: '显示' })).toContainText('场景中显示全部节点与关系类型')
  await expect(page.locator('label.facts')).toHaveCount(0)
})
