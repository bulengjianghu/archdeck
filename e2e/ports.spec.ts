/**
 * 四类交互与端口的画法（ADR-0029）：L10 查询淡（半透明、线宽不变）、委托实色；L13 端口记号在进边一侧后半、标实现者数，
 * 单击端口即选中（V2，sel=p:<接口 ID>），副栏是端口面板（K11）——定义 · 实现者（描述 / 仅代码事实）· 使用者，单击实现者选中该模块。
 */
import { expect, test } from '@playwright/test'
import { openDesk, query } from './helpers'

test('L13、V2、K11：单击端口记号出端口面板，URL 带 sel=p:，单击实现者选中该模块', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra.framework')
  const mark = page.locator('.vue-flow__node[data-id="infra.framework.plugin"] .port-mark')
  await expect(mark).toHaveCount(1)
  await expect(mark).toHaveAttribute('aria-label', /端口 PluginBase，实现者 \d+/)
  // 记号骑在节点顶边（进边一侧）的后半
  const node = (await page.locator('.vue-flow__node[data-id="infra.framework.plugin"]').boundingBox())!
  const m = (await mark.boundingBox())!
  expect(m.x).toBeGreaterThanOrEqual(node.x + node.width / 2 - 1)
  expect(Math.abs(m.y + m.height / 2 - node.y)).toBeLessThan(m.height)
  await mark.dispatchEvent('click')
  await expect.poll(() => query(page).get('sel')).toBe('p:if.framework.plugin.PluginBase')
  const panel = page.locator('.panel')
  await expect(panel.locator('h2')).toHaveText('端口 PluginBase')
  await expect(panel).toContainText('定义于')
  await expect(panel.locator('.implementers .tag', { hasText: '仅代码事实' }).first()).toBeVisible()
  await expect(mark).toHaveClass(/selected/)
  await panel.locator('.implementers .party .link').first().click()
  await expect.poll(() => query(page).get('sel')).toMatch(/^m:/)
  // 从 URL 恢复端口选中
  await openDesk(page, '/p/h5player?level=infra.framework&sel=p:if.framework.media-unit.MediaUnit')
  await expect(page.locator('.panel h2')).toHaveText('端口 MediaUnit')
})

test('L10、L12：图例示意与画布同一套样式——查询半透明、线宽与委托相同（只「淡」不「细」）；端口示意带插座', async ({ page }) => {
  // 迁移（T2）前描述里还没有查询 / 委托：在图例上验（示意与画布共用 edgeStyle）；画布上的同一映射见单测 routeEdge
  await openDesk(page, '/p/h5player?level=infra')
  // L45（第十五轮 G13）：类型行是纯图例（.item，不再是可点击的 .type 按钮），示意仍与画布同一套样式
  const types = page.getByRole('region', { name: '显示' }).locator('.type-list')
  const swatch = (label: string) => types.locator('.item', { hasText: label }).first().locator('svg.swatch line').first()
  const q = swatch('查询')
  const c = swatch('委托')
  await expect(q).toHaveAttribute('stroke', 'var(--rel-queries)')
  await expect(c).toHaveAttribute('stroke', 'var(--rel-commands)')
  await expect(q).toHaveCSS('opacity', '0.6')
  await expect(c).toHaveCSS('opacity', '1')
  expect(await q.getAttribute('stroke-width')).toBe(await c.getAttribute('stroke-width'))
  await expect(swatch('未分类')).toHaveAttribute('stroke', 'var(--rel-calls)')
  await expect(page.getByLabel('四修饰').locator('marker.socket-marker')).toHaveCount(1)
})

test('L12、L10：画布上经端口的边在目标端有插座；查询边半透明、委托实色（T2 迁移后的真实数据）', async ({ page }) => {
  // rel.solution.stage-swap-factory-base 经 SolutionStageFactory 端口（via: port:），在 app 层聚合到 Solution → 段工厂的委托边上
  await openDesk(page, '/p/h5player?level=app')
  const edge = page.locator('.vue-flow__edge[data-id="app.solution->app.factories:commands"]')
  await expect(edge).toHaveCount(1)
  await expect(edge.locator('path.edge-socket')).toHaveCount(1)
  await expect(edge.locator('.vue-flow__edge-path')).toHaveCSS('opacity', '1')
  const query = page.locator('.vue-flow__edge[data-id$=":queries"] .vue-flow__edge-path').first()
  await expect(query).toHaveCSS('opacity', '0.6')
  // 没有经端口关系的边没有插座
  await expect(page.locator('.vue-flow__edge[data-id$=":queries"]').first().locator('path.edge-socket')).toHaveCount(0)
})
