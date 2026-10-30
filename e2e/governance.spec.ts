/**
 * 架构治理（§6.10 第 5、6 条，§6.22）：开启「代码事实」，只标异常——未证实的关系边仍是实线、标签位写「未证实」，已证实的不标；代码依赖叠加线是虚线；单击叠加线看证据；根层面板有架构治理。
 * 本项目的描述已无未解释的交互、根层也没有未证实的边（经 HTTP 等的写了 via，K5b），未证实与叠加线用 h5player 验证（源码在本地是前提，G1，不设跳过）。
 * 两个项目的未解释的交互都已为 0（ADR-0026），h5player 的违规都在基线内（不画线）：叠加线用例拦截事实端点去掉基线，让违规成为「无基线的全部违规」画出来（K9）。
 */
import { expect, test } from '@playwright/test'
import { openCheckList, openDesk, query } from './helpers'

test('开启代码事实：未证实的边标「未证实」、仍是实线，已证实的不标 ✓（K9、L10、L26）', async ({ page }) => {
  await openDesk(page, '/p/h5player')
  await openCheckList(page) // PC-10：架构治理是系统核对卡的清单
  await expect(page.locator('.panel')).toContainText('架构治理')
  await expect(page.locator('.panel')).toContainText(/已证实 \d+/)
  // L45（第十五轮 G13）：代码事实开关在设置块的「代码事实与组装」组
  const toggle = page.getByRole('region', { name: '显示' }).getByRole('switch', { name: '代码事实' })
  await expect(toggle).toBeEnabled()
  await toggle.check()
  const tagged = page.locator('.vue-flow__edge-route').filter({ has: page.locator('.edge-label-warn .vue-flow__edge-text', { hasText: '未证实' }) })
  await expect(tagged.first()).toBeAttached()
  await expect(tagged.first().locator('path.vue-flow__edge-path')).toHaveCSS('stroke-dasharray', 'none')
  // 根层是分层总览：只写计数——未证实只出现在聚合边上（×N · 未证实 M）
  for (const t of await page.locator('.vue-flow__edge-text', { hasText: '未证实' }).allTextContents()) expect(t).toMatch(/^×\d+ .*未证实 \d+/)
  await expect(page.locator('.vue-flow__edge-text', { hasText: '?' })).toHaveCount(0)
  await expect(page.locator('.vue-flow__edge-text', { hasText: '✓' })).toHaveCount(0)
  // 普通层次：单条未证实的边也写字；一条边只有一个 pill
  await openDesk(page, '/p/h5player?level=infra.framework')
  await expect(page.locator('.vue-flow__edge-text', { hasText: '未证实' }).first()).toBeAttached()
  for (const e of await page.locator('.vue-flow__edge-route').all()) expect(await e.locator('.vue-flow__edge-text').count()).toBeLessThanOrEqual(1)
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
  await openCheckList(page) // PC-10：架构治理是系统核对卡的清单
  await expect(page.locator('.panel')).toContainText('架构治理')
  await expect(page.locator('.panel')).toContainText(/已证实 \d+/)

  // L45（第十五轮 G13）：代码事实开关在设置块的「代码事实与组装」组
  const toggle = page.getByRole('region', { name: '显示' }).getByRole('switch', { name: '代码事实' })
  await expect(toggle).toBeEnabled()
  await toggle.check()
  await expect(page.locator('.vue-flow__edge-text', { hasText: '✓' })).toHaveCount(0)

  // 根层的违规都落在已有的层间边上（只加红晕）；Framework 层有没有关系边的违规（外部的 app → kernel），画成叠加线
  // L44（第十四轮 F12）：一端在框外的叠加线同框外的交互边，静息态只在画布角计数，选中外部模块（聚焦边界节点）时画出
  await openDesk(page, '/p/h5player?level=infra.framework')
  await expect(page.getByTestId('overlay-corner')).toContainText(/框外代码依赖 \d+ 条（违规 \d+）/)
  await openDesk(page, '/p/h5player?level=infra.framework&sel=m:app')
  const overlay = page.locator('.vue-flow__edge[data-id^="dep:"] .vue-flow__edge-text', { hasText: '违规' }).first()
  await expect(overlay).toBeVisible()
  // L18：代码依赖叠加线是依赖——虚线
  await expect(page.locator('.vue-flow__edge[data-id^="dep:"] path.vue-flow__edge-path').first()).toHaveCSS('stroke-dasharray', '6px, 4px')
  // 叠加线的标签浮在边上，Playwright 的「稳定」判定会一直等待；h5player 根层节点密集，按坐标单击会落到节点上，这里直接在标签上派发单击
  await overlay.dispatchEvent('click')
  await expect.poll(() => query(page).get('sel')).toMatch(/^d:.+->.+$/)
  await expect(page.locator('.dep-panel')).toContainText('模块依赖')
})

test('运行视角下「显示」面板不出现「代码事实」开关（L9）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await page.getByRole('button', { name: /^显示/ }).click()
  await expect(page.getByRole('region', { name: '显示' })).toContainText('场景中显示全部节点与关系类型')
  await expect(page.getByRole('region', { name: '显示' }).getByRole('switch', { name: '代码事实' })).toHaveCount(0)
})
