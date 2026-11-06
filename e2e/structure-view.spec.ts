/**
 * 结构视角（ADR-0031、ADR-0032）：顶部三段切换与 URL v=s（V11）、节点位置与交互视角一致（V12）、结构边即束（L15、L16、L21：一对节点一条），
 * 只引类型收起与计数（L15）、只看交互使用 / 只看未解释（B1、B4）、跨界折叠与悬停画出（B2）、选中束（K10 sel=d:）与聚焦（B3）、
 * 表面展开（C6、L20）、影响面查询（K15、K15b）、分层总览（O13③）、退出场景回到进入前的视角（V11）。
 */
import { expect, test, type Page } from '@playwright/test'
import { graphNode, openDesk, openCheckList, query, collapseDisplay, waitSettled, openPanel } from './helpers'

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
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
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
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  // 画布角多了「环内 N 条已收起」（L42），收起图例（与计数按钮同一列，L48）
  await collapseDisplay(page)
  const count = page.getByTestId('type-only-corner')
  await expect(count).toHaveText(/只引类型 \d+ 条已收起/)
  const hidden = Number((await count.textContent())!.match(/(\d+) 条/)![1])
  await expect(depEdges(page).first()).toBeAttached()
  const before = await depEdges(page).count()
  // 只引类型而向上（依赖违背算出的层）的是例外，照画（K23、L42）
  const typeRest = '.dep-edge[data-tier="type"]:not([data-exception])'
  expect(await page.locator(typeRest).count()).toBe(0)
  await count.click()
  await expect(count).toHaveCount(0)
  // 计数是本层全部只引类型的依赖边；其中边界节点、共用件的边照 L4、O13 只在聚焦一端时画
  await expect(page.locator(typeRest).first()).toBeAttached()
  const shown = await page.locator(typeRest).count()
  expect(shown).toBeLessThanOrEqual(hidden)
  await expect(depEdges(page)).toHaveCount(before + shown)
})

test('L21：一对节点一条束（同方向不重复），形态混合的束标「×N 元素」', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra&v=s')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
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
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
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
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  const mark = page.getByTestId('cross-fold').first()
  await expect(mark).toHaveText(/界外 (入 \d+|出 \d+)/)
  await expect(mark).toHaveAttribute('title', /跨界折叠/)
  const before = await depEdges(page).count()
  await graphNode(page, 'boundary:domain').hover({ force: true })
  await expect.poll(() => depEdges(page).count()).toBeGreaterThan(before)
  await expect(page.locator('.vue-flow__edge-dep[data-id*="boundary:domain"]').first()).toBeAttached()
})

test('K10、B3：单击束选中这对节点的代码依赖（sel=d:），它高亮、不相连的束变淡；被依赖方不展开（T2-7，元素在面板看）', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra&v=s')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  const edge = page.locator('.vue-flow__edge-dep[data-id="bundle:infra.mus->infra.framework"]')
  const id = (await edge.getAttribute('data-id'))!
  await edge.locator('path.vue-flow__edge-interaction').dispatchEvent('click')
  const [from, to] = id.slice('bundle:'.length).split('->')
  expect(query(page).get('sel')).toBe(`d:${from}->${to}`)
  await expect(page.locator('.vue-flow__edge-dep path.edge-selected-glow').first()).toBeAttached()
  // 聚焦：不与两端相连的束变淡
  await expect.poll(() => page.locator('.vue-flow__edge-dep path.vue-flow__edge-path[style*="opacity: 0.12"]').count()).toBeGreaterThan(0)
  // T2-7：选中束只聚焦与高亮，不展开被依赖方、不重排
  await expect(graphNode(page, to).getByTestId('surface-marks')).toHaveCount(0)
  await expect(page.locator('.vue-flow__edge-dep[data-id^="el:"]')).toHaveCount(0)
})

test('C6、L20（ADR-0036）：节点角标「表面 W」；选中模块展开表面——入边一侧一排端口点、束散开为元素级边，节点与视口不动，取消选中收起', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra&v=s')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  // 展开的图例叠在画布右上，分层后 infra.framework 落在它下面
  await collapseDisplay(page)
  // infra.framework 有图解：选中会自动打开资料区并收起导航树（WS-8 例外 + WS-9，ADR-0061）。
  // 先预热——选中让它出现、隐藏资料区（标签保留，再次选中不重开）、等布局稳定，之后「选中不动视口」量的才是同一几何
  await graphNode(page, 'infra.framework').click()
  if (await page.locator('.dock-area').count()) await page.locator('.dock-toggle').click()
  await waitSettled(page)
  await expect(graphNode(page, 'infra.framework').getByTestId('node-surface-w')).toHaveText(/表面 \d+/)
  const boxes = () =>
    page.locator('.vue-flow__node-module, .vue-flow__node-core').evaluateAll(els =>
      els.map(n => [
        n.getAttribute('data-id'),
        n
          .getAttribute('style')
          ?.match(/translate\([^)]*\)|width: [\d.]+px|height: [\d.]+px/g)
          ?.join(' '),
      ]),
    )
  const before = await boxes()
  const viewport = () => page.locator('.vue-flow__transformationpane').getAttribute('style')
  const vp = await viewport()
  await graphNode(page, 'infra.framework').click()
  const marks = graphNode(page, 'infra.framework').getByTestId('surface-marks').locator('.dot')
  await expect(marks.first()).toBeAttached()
  expect(await marks.count()).toBeLessThanOrEqual(16)
  // 点不写名字、不写组名；封顶外收进「+N」
  expect((await marks.allInnerTexts()).every(t => t === '')).toBe(true)
  await expect(graphNode(page, 'infra.framework').getByTestId('surface-more')).toHaveText(/^\+\d+$/)
  await expect(page.locator('.vue-flow__edge-dep[data-id^="el:"]').first()).toBeAttached()
  await expect(marks.first()).toHaveAttribute('aria-label', /扇入 \d+/)
  await expect(graphNode(page, 'infra.framework').getByTestId('surface-group')).toHaveCount(0)
  // L20②：全部节点的位置与尺寸不变，视口不动
  await expect.poll(boxes).toEqual(before)
  expect(await viewport()).toBe(vp)
  // 返工：到点的线有箭头 marker
  const toDots = page.locator('.vue-flow__edge-dep[data-id^="el:"]:not([data-id$="#rest"]) path.vue-flow__edge-path')
  expect(await toDots.count()).toBeGreaterThan(0)
  expect(await toDots.evaluateAll(ps => ps.filter(p => !p.getAttribute('marker-end')).length)).toBe(0)
  // T2-4、C9：单击点直接定位到面板「表面」一节的该元素
  const name = (await marks.first().getAttribute('data-element'))!
  await marks.first().click()
  await expect(page.locator(`li.element[data-element="${name}"]`)).toHaveClass(/flash/)
  // L20④：悬停点——落在它上的边高亮（衬边），面板「表面」一节同一行同亮
  await page.mouse.move(0, 0)
  await marks.first().hover()
  // 返工：悬停点一定出现提示框（指针下就是这个点，不被扇出线盖住）
  await expect(page.getByTestId('surface-tip')).toBeVisible()
  await expect(page.getByTestId('surface-tip')).toContainText(name)
  await expect(page.getByTestId('surface-tip')).toContainText(/扇入 \d+/)
  await expect(page.locator(`li.element[data-element="${name}"]`)).toHaveClass(/hot/)
  await expect(page.locator('.vue-flow__edge-dep[data-id^="el:"] path.edge-hover-casing').first()).toBeAttached()
  await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
  await expect(graphNode(page, 'infra.framework').getByTestId('surface-marks')).toHaveCount(0)
  await expect(page.locator('.vue-flow__edge-dep[data-id^="el:"]')).toHaveCount(0)
  expect(await boxes()).toEqual(before)
})

test('L20②（ADR-0036）：选中 A 再换选中 B，节点 bbox 不变', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=state&v=s&sel=m:state.desk')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  await expect(page.locator('[data-testid="surface-marks"]').first()).toBeAttached()
  const boxes = () =>
    page.locator('.vue-flow__node-module, .vue-flow__node-core').evaluateAll(els =>
      els.map(n => [
        n.getAttribute('data-id'),
        n
          .getAttribute('style')
          ?.match(/translate\([^)]*\)|width: [\d.]+px|height: [\d.]+px/g)
          ?.join(' '),
      ]),
    )
  const a = await boxes()
  const other = (await page.locator('.vue-flow__node-module').evaluateAll(els => els.map(n => n.getAttribute('data-id')!))).find(id => id !== 'state.desk')!
  // 按依赖分层（L28）后节点可能落在右上角的图例之下：先收起面板再点
  const display = page.locator('.display .head-btn[aria-expanded="true"]')
  if (await display.isVisible()) await display.click()
  await graphNode(page, other).click()
  expect(query(page).get('sel')).toBe(`m:${other}`)
  await expect.poll(boxes).toEqual(a)
})

test('K15、K15b：结构视角选中模块后在面板查询影响面，按距离标在节点上，闭包外变淡', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra.framework&v=s&sel=m:infra.framework.contracts')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  const marks = page.getByTestId('impact-mark')
  // PC-8：影响面查询在核对卡的「结构指标」清单里
  await openCheckList(page, 'boundary.structure')
  await expect(page.locator('.module-structure .segmented button.on')).toHaveText('不看')
  await expect(marks).toHaveCount(0)
  await page.locator('.module-structure .segmented button[data-choice="in"]').click()
  await expect(marks.first()).toBeVisible()
  expect(await marks.count()).toBeGreaterThan(2)
  await expect(marks.first()).toHaveText(/牵动 (1|2|3\+)/)
  await expect(page.locator('.vue-flow__node .dim').first()).toBeAttached()
})

test('O13③：分层总览下的结构视角——带间画层间依赖，聚焦核心模块时画它的跨层依赖', async ({ page }) => {
  await openDesk(page, '/p/h5player?v=s')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  await expect(page.locator('.vue-flow__node-band')).toHaveCount(4)
  await expect(depEdges(page).first()).toBeAttached()
  expect(await page.locator('.vue-flow__edge-dep[data-id^="chip:"]').count()).toBe(0)
  // 本层环编号常显（Y4，不受代码事实开关影响）
  await expect(page.locator('.vue-flow__node-band .cycle-mark').first()).toBeAttached()
  // 合并复跑：拉开抽屉挤压画布后有一次再适应，悬停落在挪动中的节点上会落空——等画布静止，悬停与断言按 toPass 重试
  await waitSettled(page)
  await expect(async () => {
    await graphNode(page, 'infra.framework').hover({ force: true })
    await expect(page.locator('.vue-flow__edge-dep[data-id^="chip:"]').first()).toBeAttached({ timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
})

test('V11：从结构视角打开场景，退出回到结构视角；运行视角下单击「交互」即退出场景并进入交互视角', async ({ page }) => {
  await openDesk(page, '/p/h5player?v=s&sc=sc.command')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
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

test('§6.22、L16（ADR-0035）：结构视角的依赖全部虚线，形态只靠端点记号——端口实现在被依赖方一端为空心菱形 ◇，子类为空心三角', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra.framework&v=s&sel=m:infra.framework.contracts')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  await expect(depEdges(page).first()).toBeAttached()
  // 依赖一律断开的线：虚线；只引类型档为点线（L43，第十四轮 F11 档的新通道）
  for (const e of await depEdges(page).all()) {
    const dash = (await e.locator('.dep-edge').first().getAttribute('data-tier')) === 'type' ? '1.5px, 3.5px' : '6px, 4px'
    for (const p of await e.locator('path.vue-flow__edge-path').all()) await expect(p).toHaveCSS('stroke-dasharray', dash)
  }
  // 端口实现的终点记号是菱形（四个顶点、从原点画起），子类是三角（从尖端画起）；两者都填底色
  const endPath = (kind: string) => page.locator(`g.dep-edge[data-kind="${kind}"]`).first().locator('xpath=..').locator('marker.uml-marker path').first()
  const impl = page.locator('g.dep-edge[data-kind="implements"]')
  await expect(impl.first()).toBeAttached()
  await expect(endPath('implements')).toHaveAttribute('d', /^M0,0 L[\d.]+,-[\d.]+ L[\d.]+,0 L[\d.]+,[\d.]+ Z$/)
  await expect(endPath('implements')).toHaveAttribute('fill', 'var(--surface)')
  if (await page.locator('g.dep-edge[data-kind="subclass"]').count()) await expect(endPath('subclass')).toHaveAttribute('d', /^M[\d.]+,0 L0,/)
})

test('L20②（ADR-0036 返工）：同一束散开到几个点，分叉后的线两两没有重合线段、都带箭头', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=state&v=s&sel=m:state.transition')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  const lines = page.locator('.vue-flow__edge-dep[data-id^="el:state.desk->state.transition:"]')
  await expect(lines.first()).toBeAttached()
  const all = await lines.evaluateAll(gs =>
    gs.map(g => {
      const p = g.querySelector('path.vue-flow__edge-path')!
      const pts: { x: number; y: number }[] = []
      for (const m of (p.getAttribute('d') ?? '').matchAll(/([MLQ])([^MLQa]*)/g)) {
        const v = m[2]
          .trim()
          .split(/[\s,]+/)
          .map(Number)
        if (m[1] === 'Q') pts.push({ x: v[0], y: v[1] }, { x: v[2], y: v[3] })
        else pts.push({ x: v[0], y: v[1] })
      }
      return { marker: p.getAttribute('marker-end'), pts }
    }),
  )
  expect(all.length).toBeGreaterThan(1)
  expect(all.every(l => l.marker)).toBe(true)
  // 分叉后：每条线的最后三个点（分叉点 → 点上方 → 点的边缘）
  const segs = all.flatMap((l, i) => {
    const b = l.pts.slice(-3)
    return b.slice(1).map((q, k) => ({ i, a: b[k], b: q }))
  })
  const overlap = (u: (typeof segs)[number], v: (typeof segs)[number]) => {
    const h = Math.abs(u.a.y - u.b.y) < 0.5 && Math.abs(v.a.y - v.b.y) < 0.5 && Math.abs(u.a.y - v.a.y) < 1
    const w = Math.abs(u.a.x - u.b.x) < 0.5 && Math.abs(v.a.x - v.b.x) < 0.5 && Math.abs(u.a.x - v.a.x) < 1
    if (!h && !w) return 0
    const [p1, p2, q1, q2] = h ? [u.a.x, u.b.x, v.a.x, v.b.x] : [u.a.y, u.b.y, v.a.y, v.b.y]
    return Math.min(Math.max(p1, p2), Math.max(q1, q2)) - Math.max(Math.min(p1, p2), Math.min(q1, q2))
  }
  for (const u of segs) for (const v of segs) if (u.i < v.i) expect(overlap(u, v)).toBeLessThanOrEqual(2)
})
