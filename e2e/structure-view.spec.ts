/**
 * 结构视角（ADR-0031）：顶部三段切换与 URL v=s（V11）、节点位置与交互视角一致（V12）、结构边（L15、L16）、
 * 只引类型收起与计数（L15）、选中依赖边（K10 sel=d:）、影响面（K15）、分层总览（O13③）、退出场景回到进入前的视角（V11）。
 */
import { expect, test, type Page } from '@playwright/test'
import { graphNode, openDesk, query } from './helpers'

/** 本层模块节点的位置（Vue Flow 节点的 transform）与尺寸 */
async function boxes(page: Page) {
  return page
    .locator('.vue-flow__node-module, .vue-flow__node-core, .vue-flow__node-boundary, .vue-flow__node-band, .vue-flow__node-shared')
    .evaluateAll(els =>
      els
        .map(
          n => `${n.getAttribute('data-id')}@${n.getAttribute('style')?.match(/transform:[^;]+/)?.[0]}|${n.getAttribute('style')?.match(/width:[^;]+/)?.[0]}`,
        )
        .sort(),
    )
}

const depEdges = (page: Page) => page.locator('.vue-flow__edge-dep')
const routeEdges = (page: Page) => page.locator('.vue-flow__edge-route')
const seg = (page: Page, mode: 'structure' | 'interaction') => page.locator(`.perspective .seg[data-mode="${mode}"]`)

test('V11、V12：顶部「结构 ｜ 交互 ｜ 运行」单击切到结构视角，URL 写 v=s；节点一个不动，交互边换成结构边', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra')
  await expect(seg(page, 'interaction')).toHaveClass(/on/)
  await expect(seg(page, 'structure')).toHaveAttribute('title', '结构视角：谁依赖谁、改哪牵动哪里')
  await expect(seg(page, 'interaction')).toHaveAttribute('title', '交互视角：谁调谁、谁负责后果')
  await expect(routeEdges(page).first()).toBeAttached()
  const before = await boxes(page)

  await seg(page, 'structure').click()
  expect(query(page).get('v')).toBe('s')
  await expect(seg(page, 'structure')).toHaveClass(/on/)
  await expect(depEdges(page).first()).toBeAttached()
  await expect(routeEdges(page)).toHaveCount(0)
  expect(await boxes(page)).toEqual(before)
  // L17：节点标「入 Ca · 出 Ce」
  await expect(graphNode(page, 'infra.framework').getByTestId('node-metrics')).toHaveText(/入 \d+ · 出 \d+/)

  await seg(page, 'interaction').click()
  expect(query(page).get('v')).toBeNull()
  await expect(depEdges(page)).toHaveCount(0)
  expect(await boxes(page)).toEqual(before)
})

test('L15：只引类型的依赖边缺省收起、画布角计数；单击计数画出（边界节点的照 L4 聚焦才画），边数随之增加', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=domain&v=s')
  const count = page.getByTestId('type-only-corner')
  await expect(count).toHaveText(/只引类型 \d+ 条已收起/)
  const hidden = Number((await count.textContent())!.match(/(\d+) 条/)![1])
  await expect(depEdges(page).first()).toBeAttached()
  const before = await depEdges(page).count()
  expect(await page.locator('.dep-edge[data-tier="type"]').count()).toBe(0)
  await count.click()
  await expect(count).toHaveCount(0)
  // 计数是本层全部只引类型的依赖边；其中边界节点、共用件的边照 L4、O13 只在聚焦一端时画
  await expect(page.locator('.dep-edge[data-tier="type"]').first()).toBeAttached()
  const shown = await page.locator('.dep-edge[data-tier="type"]').count()
  expect(shown).toBeLessThanOrEqual(hidden)
  await expect(depEdges(page)).toHaveCount(before + shown)
})

test('K10：单击结构边选中这对节点的代码依赖（sel=d:），画布上它高亮', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=domain&v=s')
  const edge = page.locator('.vue-flow__edge-dep[data-id^="dependency:"]').first()
  const id = (await edge.getAttribute('data-id'))!
  await edge.locator('path.vue-flow__edge-interaction').dispatchEvent('click')
  const [from, to] = id.slice('dependency:'.length).split('->')
  expect(query(page).get('sel')).toBe(`d:${from}->${to}`)
  await expect(page.locator(`.vue-flow__edge-dep[data-id="${id}"] path.edge-selected-glow`)).toBeAttached()
})

test('K15：结构视角选中模块时影响面按距离标在节点上，闭包外变淡', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra.framework&v=s&sel=m:infra.framework.contracts')
  const marks = page.getByTestId('impact-mark')
  await expect(marks.first()).toBeVisible()
  expect(await marks.count()).toBeGreaterThan(2)
  await expect(marks.first()).toHaveText(/牵动 (1|2|3\+)/)
  await expect(page.locator('.vue-flow__node .dim').first()).toBeAttached()
})

test('O13③：分层总览下的结构视角——带间画层间依赖，聚焦核心模块时画它的跨层依赖', async ({ page }) => {
  await openDesk(page, '/p/h5player?v=s')
  await expect(page.locator('.vue-flow__node-band')).toHaveCount(4)
  await expect(depEdges(page).first()).toBeAttached()
  expect(await page.locator('.vue-flow__edge-dep[data-id^="chip:"]').count()).toBe(0)
  // 本层环编号常显（Y4，不受代码事实开关影响）
  await expect(page.locator('.vue-flow__node-band .cycle-mark').first()).toBeAttached()
  await graphNode(page, 'infra.framework').hover({ force: true })
  await expect(page.locator('.vue-flow__edge-dep[data-id^="chip:"]').first()).toBeAttached()
})

test('V11：从结构视角打开场景，退出回到结构视角；运行视角下单击「交互」即退出场景并进入交互视角', async ({ page }) => {
  await openDesk(page, '/p/h5player?v=s&sc=sc.command')
  await expect(page.locator('.perspective .seg.run')).toHaveClass(/on/)
  await expect(depEdges(page)).toHaveCount(0)
  await page.locator('.perspective .exit').click()
  expect(query(page).get('sc')).toBeNull()
  expect(query(page).get('v')).toBe('s')
  await expect(seg(page, 'structure')).toHaveClass(/on/)

  await page.goto('./#/p/h5player?v=s&sc=sc.command')
  await expect(page.locator('.perspective .seg.run')).toHaveClass(/on/)
  await seg(page, 'interaction').click()
  expect(query(page).get('sc')).toBeNull()
  expect(query(page).get('v')).toBeNull()
  await expect(seg(page, 'interaction')).toHaveClass(/on/)
})
