/**
 * 系统 | 视图（第二十二轮 ADR-0064，验收 §6.44）：两区布局与三区页头（LY-1、LY-2，I6）、选中不改变任何区域的宽度（I3）、
 * 主语条（LY-7）、标签拖拽换组 / 换序与分隔（LY-10，I7）。几何断言只认语义锚点（data-region、data-head、data-group）。
 */
import { expect, test, type Page } from '@playwright/test'
import { activeTab, collapseDisplay, openDesk, query, rail, sidePage, viewTab, views, waitSettled } from './helpers'

const box = async (page: Page, sel: string) => {
  const b = await page.locator(sel).first().boundingBox()
  expect(b, sel).not.toBeNull()
  return { x: Math.round(b!.x), y: Math.round(b!.y), w: Math.round(b!.width), h: Math.round(b!.height) }
}
/** 侧栏、画布、视图区三块的 bbox */
const regions = async (page: Page) => ({
  sidebar: await box(page, '.side-area'),
  canvas: await box(page, '[data-region="canvas"]'),
  views: await box(page, '[data-region="views"]'),
})

test('I6、LY-1、LY-2：竖栏顶格与三区页头同高 44px（含 1px 底线）、底线对齐；没有全宽顶栏', async ({ page }) => {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await openDesk(page, '/p/h5p-arch-desk')
    // 1280 侧栏缺省收起：展开它，三区都在
    const toggle = page.locator('[data-head="rail"]').getByRole('button', { name: '侧栏', exact: true })
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
    await expect(page.getByRole('banner', { name: '工具栏' })).toHaveCount(0)
    const heads = await Promise.all(['rail', 'sidebar', 'canvas', 'views'].map(h => box(page, `[data-head="${h}"]`)))
    for (const h of heads) {
      expect(h.y).toBe(0)
      expect(h.h).toBe(44)
    }
    // 底线：1px 实线，在 y = 43 那一行
    const lines = (await page.evaluate(`['rail', 'sidebar', 'canvas', 'views'].map(h => {
      const s = getComputedStyle(document.querySelector('[data-head="' + h + '"]'))
      return s.borderBottomWidth + ' ' + s.borderBottomStyle
    })`)) as string[]
    expect(lines).toEqual(['1px solid', '1px solid', '1px solid', '1px solid'])
    // 从左到右：竖栏 | 侧栏 | 画布 | 视图区，铺满窗口宽
    const r = await regions(page)
    expect((await box(page, '[data-region="rail"]')).w).toBe(44)
    expect(r.sidebar.x).toBe(44)
    expect(r.canvas.x).toBe(44 + r.sidebar.w)
    expect(r.views.x + r.views.w).toBe(width)
  }
})

test('I3：选中任何对象前后，侧栏、画布、视图区的 bbox 都不变（模块、关系、参与者、步骤、取消选中）', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit')
  await collapseDisplay(page)
  await waitSettled(page)
  const before = await regions(page)
  // 模块
  await page.locator('.vue-flow__node-module, .vue-flow__node-core').first().click()
  await expect(page.locator('[data-testid="subject-name"]')).not.toHaveText('播放器 Kit')
  expect(await regions(page)).toEqual(before)
  // 关系（单击边的标签）
  const edge = page.locator('.vue-flow__edge-route .vue-flow__edge-text').first()
  if (await edge.count()) {
    await edge.dispatchEvent('click')
    await expect(page.locator('[data-head="views"] .tag')).toHaveText(/关系|边/)
    expect(await regions(page)).toEqual(before)
  }
  // 取消选中：单击画布空白（主语回到当前层次的父模块，LY-7a）
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-testid="subject-name"]')).toHaveText('播放器 Kit')
  expect(await regions(page)).toEqual(before)
  // 回放中单步、选中步骤：同样不变
  await openDesk(page, '/p/media-web-player?level=kit&sc=sc.command')
  await waitSettled(page)
  const run0 = await regions(page)
  await page.locator('.player button.next').click()
  await expect(page.locator('[data-head="views"] .tag')).toHaveText('步骤')
  expect(await regions(page)).toEqual(run0)
})

test('LY-7：主语条一行——所在路径（灰）› 名称 + ID + 角色徽标；无选中为当前层次的父模块，根层为系统', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const bar = page.locator('[data-head="views"]')
  await expect(bar.locator('[data-testid="subject-name"]')).toHaveText('h5p-arch-desk')
  await expect(bar.locator('.tag')).toHaveText('系统')
  await openDesk(page, '/p/h5p-arch-desk?level=state&sel=m:state.desk')
  await expect(bar.locator('[data-testid="subject-name"]')).toHaveText('DeskState')
  await expect(bar.locator('.id')).toHaveText('state.desk')
  await expect(bar.locator('.path')).toContainText('视图状态层 ›')
  // 主语条全页只一处
  await expect(page.locator('[data-head="views"]')).toHaveCount(1)
  // 下钻后无选中：主语是被下钻的模块
  await page.keyboard.press('Escape')
  await expect(bar.locator('[data-testid="subject-name"]')).toHaveText('视图状态层')
})

test('I7、LY-10：拖标签到下半区开下组，分隔可拖，拖回上组即合并；组内拖动换序；视图标签常驻没有 ×', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const groups = views(page).locator('.group')
  await expect(groups).toHaveCount(1)
  await expect(views(page).locator('.tab[data-view-tab] .x')).toHaveCount(0)
  // 组内换序：把「核对」拖到「图解」之前
  await viewTab(page, 'check').dragTo(viewTab(page, 'explainer'), { targetPosition: { x: 4, y: 10 } })
  await expect(views(page).locator('[data-group="0"] .tab').first()).toHaveAttribute('data-view-tab', 'check')
  // 拖「描述」到下半区：开下组，描述在下组并激活
  const desc = viewTab(page, 'description')
  await desc.hover()
  await page.mouse.down()
  const vb = (await views(page).boundingBox())!
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height * 0.85, { steps: 6 })
  await expect(page.locator('[data-splitzone]')).toBeVisible()
  await page.mouse.up()
  await expect(groups).toHaveCount(2)
  await expect(activeTab(page, 1)).toHaveAttribute('data-view-tab', 'description')
  // 分隔可拖：上组变高
  const top0 = (await groups.nth(0).boundingBox())!.height
  const sep = (await views(page).locator('.gsplit').boundingBox())!
  await page.mouse.move(sep.x + sep.width / 2, sep.y + 2)
  await page.mouse.down()
  await page.mouse.move(sep.x + sep.width / 2, sep.y + 80, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await groups.nth(0).boundingBox())!.height).toBeGreaterThan(top0 + 40)
  // 拖回上组：下组拖空即合并
  await viewTab(page, 'description').dragTo(views(page).locator('[data-group="0"] .tabs'))
  await expect(groups).toHaveCount(1)
  // 排布按本机记住（LY-11）：重新打开仍是人改过的次序
  await openDesk(page, '/p/h5p-arch-desk')
  await expect(views(page).locator('[data-group="0"] .tab').first()).toHaveAttribute('data-view-tab', 'check')
})

test('LY-4、LY-4a：竖栏三页（改动只在草图编辑时可用）；画布 ⚠ 打开「问题」资料标签，「+」菜单只开资料', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const side = page.locator('[data-region="sidebar"]')
  await expect(rail(page).locator('[data-rail]')).toHaveCount(3)
  expect(
    await rail(page)
      .locator('[data-rail]')
      .evaluateAll(es => es.map(e => e.getAttribute('aria-label'))),
  ).toEqual(['模块', '场景', '改动'])
  await expect(rail(page).locator('[data-rail="changes"]')).toBeDisabled()
  await sidePage(page, 'scenes')
  await expect(side.locator('.scenario-list')).toBeVisible()
  // ⚠ → 问题资料标签（不跟随主语）
  await page.locator('.issue-badge').click()
  await expect(activeTab(page, 0)).toHaveAttribute('data-doc-tab', 'issues')
  await expect(views(page).locator('.issue-list')).toBeVisible()
  await collapseDisplay(page)
  await page.locator('.vue-flow__node-module, .vue-flow__node-core').first().click()
  await expect(views(page).locator('.tab[data-doc-tab="issues"]')).toHaveCount(1)
  // 「+」：只有资料 · 不跟随主语（视图标签常驻，LY-9）
  await views(page).getByRole('button', { name: '添加标签' }).click()
  const menu = views(page).getByRole('menu', { name: '添加标签' })
  await expect(menu.locator('.mh')).toHaveText(['资料 · 不跟随主语'])
  await expect(menu.locator('[data-add-view]')).toHaveCount(0)
  await expect(menu.locator('[data-add-doc]')).toHaveText([/对话/])
})

test('T3.5 下钻与直达的适应缩放：侧栏与视图区宽度定下后才适应——节点包围盒的中心落在画布中央的容差内（1440、侧栏展开）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await waitSettled(page)
  const center = async () =>
    (await page.evaluate(`(() => {
      const c = document.querySelector('[data-region="canvas"] .vue-flow').getBoundingClientRect()
      const ns = [...document.querySelectorAll('.vue-flow__node')].map(n => n.getBoundingClientRect()).filter(r => r.width > 0)
      const l = Math.min(...ns.map(r => r.left)), t = Math.min(...ns.map(r => r.top)), r = Math.max(...ns.map(r => r.right)), b = Math.max(...ns.map(r => r.bottom))
      return { dx: (l + r) / 2 - (c.left + c.width / 2), dy: (t + b) / 2 - (c.top + c.height / 2), w: c.width, h: c.height, bw: r - l, bh: b - t }
    })()`)) as { dx: number; dy: number; w: number; h: number; bw: number; bh: number }
  for (const level of ['state', 'present']) {
    await page.locator(`[data-region="sidebar"] .row[data-id="${level}"]`).dblclick()
    await expect.poll(() => query(page).get('level')).toBe(level)
    await waitSettled(page)
    const m = await center()
    expect(Math.abs(m.dx), `${level} 水平居中`).toBeLessThan(m.w * 0.08)
    expect(Math.abs(m.dy), `${level} 垂直居中`).toBeLessThan(m.h * 0.08)
    // 适应后占满画布的一边（不是缩在一角）
    expect(Math.max(m.bw / m.w, m.bh / m.h)).toBeGreaterThan(0.6)
    await page.keyboard.press('Backspace')
    await expect.poll(() => query(page).get('level')).toBeNull()
    await waitSettled(page)
  }
  // 首次进入就在下一层、带选中（地址直达）：同样居中、占满
  await openDesk(page, '/p/h5p-arch-desk?level=state&sel=m:state.desk')
  await waitSettled(page)
  const m = await center()
  expect(Math.abs(m.dx), '直达 水平居中').toBeLessThan(m.w * 0.08)
  expect(Math.abs(m.dy), '直达 垂直居中').toBeLessThan(m.h * 0.08)
  expect(Math.max(m.bw / m.w, m.bh / m.h)).toBeGreaterThan(0.6)
  // 地址栏里改层次（不重新加载，同一张画布）：同样
  await openDesk(page, '/p/h5p-arch-desk?v=s')
  await waitSettled(page)
  await page.evaluate("location.hash = '#/p/h5p-arch-desk?level=state&sel=m:state.desk'")
  await expect.poll(() => query(page).get('level')).toBe('state')
  await waitSettled(page)
  const n = await center()
  expect(Math.abs(n.dx), '改地址 水平居中').toBeLessThan(n.w * 0.08)
  expect(Math.abs(n.dy), '改地址 垂直居中').toBeLessThan(n.h * 0.08)
  expect(Math.max(n.bw / n.w, n.bh / n.h)).toBeGreaterThan(0.6)
})

test('LY-15、I1：视图里悬停模块引用，画布提示它的位置（悬停，不移动视口），离开即消失；单击引用 = 画布选中，视图跟随主语', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=state')
  await collapseDisplay(page)
  await waitSettled(page)
  const hover = () => page.evaluate('window.__desk.hoverId.value') as Promise<string | null>
  const viewport = () => page.evaluate(`getComputedStyle(document.querySelector('.vue-flow__transformationpane')).transform`)
  await page.locator('[data-region="views"] [data-view-tab="description"] .lbl').click()
  const ref = views(page).locator('[data-ref-module="state.desk"]').first()
  await expect(ref).toBeVisible()
  const vp0 = await viewport()
  await ref.hover()
  await expect.poll(hover).toBe('state.desk')
  await expect(page.locator('.vue-flow__node[data-id="state.desk"]')).toHaveClass(/\bpeek\b/)
  expect(await viewport()).toBe(vp0)
  // 离开引用：提示消失
  await page.locator('[data-head="views"]').hover()
  await expect.poll(hover).toBeNull()
  await expect(page.locator('.vue-flow__node.peek')).toHaveCount(0)
  // 单击 = 选中，主语条跟随
  await ref.click()
  await expect.poll(() => query(page).get('sel')).toBe('m:state.desk')
  await expect(page.locator('[data-testid="subject-name"]')).toHaveText('DeskState')
})

test('LY-13：描述没有身份卡与核对卡（名称只在主语条），核对只放核对卡；系统与层的核对先给汇总', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=state&sel=m:state.desk')
  await page.locator('[data-region="views"] [data-view-tab="description"] .lbl').click()
  const desc = views(page).locator('.panel[data-part="description"]')
  await expect(desc.locator('[data-card="understand"]')).toBeVisible()
  await expect(desc.locator('[data-card="check"]')).toHaveCount(0)
  await expect(desc.locator('.id-card h2')).toHaveCount(0)
  await expect(desc.getByRole('button', { name: '讨论 ›' })).toBeVisible()
  await page.locator('[data-region="views"] [data-view-tab="check"] .lbl').click()
  const check = views(page).locator('.panel[data-part="check"]')
  await expect(check.locator('[data-card="check"]').first()).toBeVisible()
  await expect(check.locator('[data-card="understand"]')).toHaveCount(0)
  await expect(check.locator('[data-testid="scope-summary"]')).toHaveCount(0)
  // 系统：汇总（违规、环、未证实、未归属、需复核）
  await openDesk(page, '/p/h5p-arch-desk')
  await page.locator('[data-region="views"] [data-view-tab="check"] .lbl').click()
  const sum = views(page).locator('[data-testid="scope-summary"]')
  await expect(sum).toBeVisible()
  await expect(sum.locator('[data-scope]')).toHaveCount(5)
  // 层（单成员层即模块）：同样有汇总
  await openDesk(page, '/p/h5p-arch-desk?sel=m:state')
  await page.locator('[data-region="views"] [data-view-tab="check"] .lbl').click()
  await expect(views(page).locator('[data-testid="scope-summary"]')).toBeVisible()
})

test('LY-13、LY-14：图解只放讲解；主语没有讲解时给空态——相关模块的图解链接与「到描述看事实 ›」', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=state&sel=m:state.desk')
  // DeskState 有图解：只有讲解（沙箱 iframe），没有事实卡
  await expect(views(page).locator('.explainer iframe')).toBeVisible()
  await expect(views(page).locator('[data-sec="understand"]')).toHaveCount(0)
  // Layout 没有图解：空态，链到所属的有图解模块，单击「到描述看事实 ›」换到描述
  await openDesk(page, '/p/h5p-arch-desk?level=state.desk&sel=m:state.desk.writer')
  const empty = views(page).getByTestId('explainer-empty')
  await expect(empty).toContainText('没有图解')
  await expect(empty.getByTestId('explainer-link').first()).toBeVisible()
  await empty.getByTestId('to-description').click()
  await expect(activeTab(page, 0)).toHaveAttribute('data-view-tab', 'description')
})
