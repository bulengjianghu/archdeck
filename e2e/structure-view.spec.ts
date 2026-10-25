/**
 * 结构视角（ADR-0031、ADR-0032）：顶部三段切换与 URL v=s（V11）、节点位置与交互视角一致（V12）、结构边即束（L15、L16、L21：一对节点一条），
 * 只引类型收起与计数（L15）、只看交互使用 / 只看未解释（B1、B4）、跨界折叠与悬停画出（B2）、选中束（K10 sel=d:）与聚焦（B3）、
 * 表面展开（C6、L20）、影响面（K15）、分层总览（O13③）、退出场景回到进入前的视角（V11）。
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

test('L21：一对节点一条束（同方向不重复），形态混合的束标「×N 元素」', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra&v=s')
  await expect(depEdges(page).first()).toBeAttached()
  const ids = await depEdges(page).evaluateAll(els => els.map(e => e.getAttribute('data-id')!))
  expect(ids.every(id => id.startsWith('bundle:'))).toBe(true)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids.length).toBeLessThan(48)
  await expect(page.locator('.dep-edge[data-elements]').first()).toBeAttached()
  await expect(
    page
      .locator('.vue-flow__edge-dep .vue-flow__edge-text')
      .filter({ hasText: /×\d+ 元素/ })
      .first(),
  ).toBeAttached()
})

test('B1、B4：只看交互使用、只看未解释两个开关按项目记本地，画布角计数收起的束，单击计数关掉开关', async ({ page }) => {
  await page.goto('./')
  await page.evaluate(() => localStorage.setItem('h5p-arch-desk:structure-prefs:h5player', JSON.stringify({ invokesOnly: true })))
  await openDesk(page, '/p/h5player?level=domain&v=s')
  const value = page.getByTestId('value-hidden-corner')
  await expect(value).toHaveText(/值使用 \d+ 条已收起/)
  // 违规、环上、逆稳定的值使用照画，其余收起
  const kept = await page.locator('.dep-edge[data-tier="value"]').count()
  await value.dispatchEvent('click')
  await expect(value).toHaveCount(0)
  await expect.poll(() => page.locator('.dep-edge[data-tier="value"]').count()).toBeGreaterThan(kept)

  await page.evaluate(() => localStorage.setItem('h5p-arch-desk:structure-prefs:h5player', JSON.stringify({ uncoveredOnly: true })))
  await page.reload()
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
  const covered = page.getByTestId('covered-hidden-corner')
  await expect(covered).toHaveText(/已解释 \d+ 条已收起/)
  const fewer = await depEdges(page).count()
  await covered.dispatchEvent('click')
  await expect(covered).toHaveCount(0)
  await expect.poll(() => depEdges(page).count()).toBeGreaterThan(fewer)
  await page.evaluate(() => localStorage.removeItem('h5p-arch-desk:structure-prefs:h5player'))
})

test('B2：一端是边界节点的束跨界折叠——节点标「界外 入 N · 出 M」，悬停另一端（边界节点）时画出', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra&v=s')
  const mark = page.getByTestId('cross-fold').first()
  await expect(mark).toHaveText(/界外 (入 \d+|出 \d+)/)
  await expect(mark).toHaveAttribute('title', /跨界折叠/)
  const before = await depEdges(page).count()
  await graphNode(page, 'boundary:domain').hover({ force: true })
  await expect.poll(() => depEdges(page).count()).toBeGreaterThan(before)
  await expect(page.locator('.vue-flow__edge-dep[data-id*="boundary:domain"]').first()).toBeAttached()
})

test('K10、B3：单击束选中这对节点的代码依赖（sel=d:），它高亮、不相连的束变淡；被依赖方展开这条束接到的元素', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra&v=s')
  const edge = page.locator('.vue-flow__edge-dep[data-id="bundle:infra.mus->infra.framework"]')
  const id = (await edge.getAttribute('data-id'))!
  await edge.locator('path.vue-flow__edge-interaction').dispatchEvent('click')
  const [from, to] = id.slice('bundle:'.length).split('->')
  expect(query(page).get('sel')).toBe(`d:${from}->${to}`)
  await expect(page.locator('.vue-flow__edge-dep path.edge-selected-glow').first()).toBeAttached()
  // 聚焦：不与两端相连的束变淡
  await expect.poll(() => page.locator('.vue-flow__edge-dep path.vue-flow__edge-path[style*="opacity: 0.12"]').count()).toBeGreaterThan(0)
  // 被依赖方展开：元素记号出现
  await expect(graphNode(page, to).getByTestId('surface-marks')).toBeAttached()
})

test('C6、L20：节点角标「表面 W」；选中模块展开表面——元素记号排在入边一侧、束散开为元素级边，取消选中收起', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra&v=s')
  await expect(graphNode(page, 'infra.framework').getByTestId('node-surface-w')).toHaveText(/表面 \d+/)
  const w0 = await graphNode(page, 'infra.framework').evaluate(n => n.getBoundingClientRect().width)
  await graphNode(page, 'infra.framework').click()
  const marks = graphNode(page, 'infra.framework').getByTestId('surface-marks').locator('.element')
  await expect(marks.first()).toBeAttached()
  expect(await marks.count()).toBeLessThanOrEqual(16)
  await expect(graphNode(page, 'infra.framework').getByTestId('surface-more')).toHaveText(/\+\d+ 个元素/)
  await expect(page.locator('.vue-flow__edge-dep[data-id^="el:"]').first()).toBeAttached()
  await expect(marks.first()).toHaveAttribute('title', /扇入 \d+/)
  // 节点尺寸随元素数变化（本层重新布局）
  await expect.poll(() => graphNode(page, 'infra.framework').evaluate(n => n.getBoundingClientRect().width)).not.toBe(w0)
  await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
  await expect(graphNode(page, 'infra.framework').getByTestId('surface-marks')).toHaveCount(0)
  await expect(page.locator('.vue-flow__edge-dep[data-id^="el:"]')).toHaveCount(0)
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
