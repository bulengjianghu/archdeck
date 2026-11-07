/**
 * 系统 | 视图（第二十二轮 ADR-0064，验收 §6.44）：两区布局与三区页头（LY-1、LY-2，I6）、选中不改变任何区域的宽度（I3）、
 * 主语条（LY-7）、标签拖拽换组 / 换序与分隔（LY-10，I7）。几何断言只认语义锚点（data-region、data-head、data-group）。
 */
import { expect, test, type Page } from '@playwright/test'
import { activeTab, collapseDisplay, openDesk, viewTab, views, waitSettled } from './helpers'

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

test('I6、LY-1、LY-2：三区页头同高 44px（含 1px 底线）、底线对齐；没有全宽顶栏', async ({ page }) => {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await openDesk(page, '/p/h5p-arch-desk')
    // 1280 侧栏缺省收起：展开它，三区都在
    const toggle = page.locator('[data-head="canvas"]').getByRole('button', { name: '侧栏', exact: true })
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
    await expect(page.getByRole('banner', { name: '工具栏' })).toHaveCount(0)
    const heads = await Promise.all(['sidebar', 'canvas', 'views'].map(h => box(page, `[data-head="${h}"]`)))
    for (const h of heads) {
      expect(h.y).toBe(0)
      expect(h.h).toBe(44)
    }
    // 底线：1px 实线，在 y = 43 那一行
    const lines = (await page.evaluate(`['sidebar', 'canvas', 'views'].map(h => {
      const s = getComputedStyle(document.querySelector('[data-head="' + h + '"]'))
      return s.borderBottomWidth + ' ' + s.borderBottomStyle
    })`)) as string[]
    expect(lines).toEqual(['1px solid', '1px solid', '1px solid'])
    // 三块从左到右：侧栏 | 画布 | 视图区，铺满窗口宽
    const r = await regions(page)
    expect(r.sidebar.x).toBe(0)
    expect(r.canvas.x).toBe(r.sidebar.w)
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

test('I7、LY-10：拖标签到下半区开下组，分隔可拖，拖回上组即合并；组内拖动换序；图解常驻没有 ×', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const groups = views(page).locator('.group')
  await expect(groups).toHaveCount(1)
  await expect(viewTab(page, 'explainer').locator('.x')).toHaveCount(0)
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

test('LY-4、LY-4a：侧栏三页（改动只在草图编辑时可用）；画布 ⚠ 打开「问题」资料标签，「+」菜单分视图 / 资料两节', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const side = page.locator('[data-region="sidebar"]')
  await expect(side.getByRole('tab')).toHaveText([/^\s*模块\s*$/, /^\s*场景\s*$/, /^\s*改动/])
  await expect(side.locator('[data-side-page="changes"]')).toBeDisabled()
  await side.locator('[data-side-page="scenes"]').click()
  await expect(side.locator('.scenario-list')).toBeVisible()
  // ⚠ → 问题资料标签（不跟随主语）
  await page.locator('.issue-badge').click()
  await expect(activeTab(page, 0)).toHaveAttribute('data-doc-tab', 'issues')
  await expect(views(page).locator('.issue-list')).toBeVisible()
  await collapseDisplay(page)
  await page.locator('.vue-flow__node-module, .vue-flow__node-core').first().click()
  await expect(views(page).locator('.tab[data-doc-tab="issues"]')).toHaveCount(1)
  // 「+」：视图 · 跟随主语 / 资料 · 不跟随
  await views(page).locator('[data-view-tab="check"] .x').click()
  await views(page).getByRole('button', { name: '添加标签' }).click()
  const menu = views(page).getByRole('menu', { name: '添加标签' })
  await expect(menu.locator('.mh')).toHaveText(['视图 · 跟随主语', '资料 · 不跟随'])
  await expect(menu.locator('[data-add-view]')).toHaveText(['核对'])
  await expect(menu.locator('[data-add-doc]')).toHaveText([/对话/])
})
