/**
 * 交互视角的第八轮呈现（ADR-0032）：选中一条交互时承载叠加（L22：承载段按结构视图的形态记号临时画出（虚线）并高亮，缺段为警示色虚线并标「缺段」，其余变淡），
 * 接收方表面展开时交互束按接口散开（L23，只画被交互接到的元素），束内修饰不一致标「混合」（D8）；结构视角选中束时反向高亮它承载的交互（L22）。
 */
import { expect, test } from '@playwright/test'
import { graphNode, openDesk, query } from './helpers'

test('L22：选中一条经端口的交互，承载段临时画出并高亮，其余边与节点变淡；取消选中恢复', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=app&sel=r:rel.solution.stage-swap-factory-base')
  const seg = page.locator('.vue-flow__edge-dep[data-id^="carrier:rel.solution.stage-swap-factory-base:"]')
  await expect(seg.first()).toBeAttached()
  await expect(seg.first().locator('.dep-edge.dep-carrier')).toBeAttached()
  await expect(seg.first().locator('title')).toHaveText(/承载（经端口/)
  // §6.22：叠出的承载段全是虚线（依赖），选中的交互是实线
  for (const p of await seg.locator('path.vue-flow__edge-path').all()) await expect(p).toHaveCSS('stroke-dasharray', '6px, 4px')
  await expect(
    page
      .locator('.vue-flow__edge-route')
      .filter({ has: page.locator('.edge-selected') })
      .first()
      .locator('path.vue-flow__edge-path'),
  ).toHaveCSS('stroke-dasharray', 'none')
  await expect(page.locator('.vue-flow__node .dim').first()).toBeAttached()
  // 接收方展开：只画被交互 / 承载段接到的元素
  await expect(graphNode(page, 'app.factories').getByTestId('surface-marks')).toBeAttached()
  await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
  expect(query(page).get('sel')).toBeNull()
  await expect(seg).toHaveCount(0)
})

test('D8：束内同步 / 异步或 via 不一致标「混合」，悬停列出各条', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=app')
  const mixed = page.locator('.vue-flow__edge-route g[data-mixed]').first()
  await expect(mixed).toBeAttached()
  await expect(mixed.locator('title')).toHaveText(/不一致（D8）/)
  await expect(mixed.locator('.vue-flow__edge-text')).toHaveText(/混合/)
})

test('L23：选中模块时交互束按接口散开到它的元素（#to:<元素>），节点只画被接到的元素', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=app&sel=m:app.factories')
  const parts = page.locator('.vue-flow__edge-route[data-id^="app.solution->app.factories:commands#to:"]')
  await expect(parts.first()).toBeAttached()
  const marks = graphNode(page, 'app.factories').getByTestId('surface-marks').locator('.dot')
  await expect(marks.first()).toBeAttached()
  // 只画被接到的元素：记号数不多于散开的段接到的元素数（另有其他发起方的段）
  const hit = new Set(
    (
      await page.locator('.vue-flow__edge-route[data-id*="->app.factories:"][data-id*="#to:"]').evaluateAll(els => els.map(e => e.getAttribute('data-id')!))
    ).map(id => id.slice(id.indexOf('#to:') + 4)),
  )
  expect(await marks.count()).toBe(hit.size)
  await expect(graphNode(page, 'app.factories').getByTestId('surface-more')).toHaveCount(0)
})

test('L22 反向：结构视角选中束时它承载的交互临时画出；单击切到交互视角并选中它', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra&v=s')
  // 找一条有交互覆盖的束：悬停说明写「交互覆盖 N 条」且 N > 0
  const edge = page
    .locator('.vue-flow__edge-dep')
    .filter({ has: page.locator('title', { hasText: /交互覆盖 [1-9]/ }) })
    .first()
  await edge.locator('path.vue-flow__edge-interaction').dispatchEvent('click')
  const carried = page.locator('.vue-flow__edge-route g[data-temp="carried"]')
  await expect(carried.first()).toBeAttached()
  // L22、L18：反向画出的承载交互是交互——实线
  await expect(carried.first().locator('path.vue-flow__edge-path')).toHaveCSS('stroke-dasharray', 'none')
  await carried.first().locator('path.vue-flow__edge-interaction').dispatchEvent('click')
  await expect(page.locator('.perspective .seg[data-mode="interaction"]')).toHaveClass(/on/)
  expect(query(page).get('sel')).toMatch(/^r:/)
})
