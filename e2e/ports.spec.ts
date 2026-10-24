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
  const types = page.getByRole('group', { name: '关系类型筛选' })
  const swatch = (label: string) =>
    types
      .getByRole('button', { name: new RegExp(`^${label}`) })
      .locator('svg.swatch line')
      .first()
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
