/**
 * 工作区布局（第二十二轮 LY-8–LY-12，ADR-0064）：视图区常在（图解常驻）、按情境排布、可整体收起（画布右上角「视图 · 主语名 ›」）；
 * 资料标签预览替换与固定、进上组、不跟随主语；选中文件在视图区打开源代码（G15、§6.4）。选中抽屉、导航浮层已删（LY-16）。
 */
import { expect, test, type Page } from '@playwright/test'
import {
  activeTab,
  closeNav,
  collapseDisplay,
  docTab,
  docTabs,
  graphNode,
  openDesk,
  openFilters,
  query,
  sidebar,
  sidePage,
  viewTab,
  views,
  openSidebar,
} from './helpers'

const dock = views
/** 标签的键（标签名里带核对结论与时序图进度，会随主语与进度变，比较排布只看键） */
const tabIds = (page: Page) => tabs(page).evaluateAll(ts => ts.map(t => t.getAttribute('data-doc')))
const tabs = (page: Page) => dock(page).locator('.tabs > .tab')
const viewsBtn = (page: Page) => page.locator('[data-head="canvas"]').getByRole('button', { name: '视图区', exact: true })

/** 侧栏模块页「按文件」的树里单击 / 双击一个文件（目录未展开时先展开，LY-4b） */
async function pickFile(page: Page, path: string, dbl = false) {
  // LY-4d：「按文件」收在模块页的「筛选 ▾」弹层里，选完收起弹层
  await sidePage(page, 'modules')
  if (!(await sidebar(page).locator('.file-tree').count())) {
    const pop = await openFilters(page)
    await pop.locator('[data-side-mode="files"]').click()
    await sidebar(page).locator('[data-side-filter]').click()
  }
  const parts = path.split('/').slice(0, -1)
  for (let i = 1; i <= parts.length; i++) {
    const dir = page.locator(`.row.dir[data-dir="${parts.slice(0, i).join('/')}"]`)
    if ((await dir.locator('.caret').innerText()) === '▸') await dir.click()
  }
  const row = page.locator(`.row.file[data-path="${path}"]`)
  if (dbl) await row.dblclick()
  else await row.click()
}

test('LY-9、LY-12：视图区常在（图解常驻）、可整体收起——收起时画布右上角「视图 · 主语名 ›」单击展开；收起按本机记住；回放中按场景排布', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit')
  await expect(dock(page)).toBeVisible()
  await expect(activeTab(page)).toHaveAttribute('data-view-tab', 'explainer')
  await expect(page.locator('[data-views-pill]')).toHaveCount(0)
  // 收起视图区：画布右沿到窗口右沿；胶囊写主语（无选中 = 当前层次的父模块，LY-7a）
  await viewsBtn(page).click()
  await expect(dock(page)).toHaveCount(0)
  const pill = page.locator('[data-views-pill]')
  await expect(pill).toContainText('视图 · 播放器 Kit')
  const canvas = (await page.locator('.canvas-area').boundingBox())!
  expect(Math.round(canvas.x + canvas.width)).toBe(1440)
  // 胶囊在画布右上角
  const pb = (await pill.boundingBox())!
  expect(canvas.x + canvas.width - (pb.x + pb.width)).toBeLessThan(20)
  expect(pb.y - canvas.y).toBeLessThan(20)

  // 视图区收起按本机记住（LY-12a）：同一页面换地址仍收起；胶囊单击展开
  await openDesk(page, '/p/media-web-player?level=kit&sc=sc.command')
  await expect(dock(page)).toHaveCount(0)
  await page.locator('[data-views-pill]').click()
  await expect(dock(page)).toBeVisible()
  await expect(page.locator('[data-views-pill]')).toHaveCount(0)
  // 时序图标签（场景排布的上组激活）内容区顶部有「定位」「图例」（WS-10）
  await expect(activeTab(page, 0)).toHaveAttribute('data-view-tab', 'sequence')
  await expect(viewTab(page, 'sequence')).toContainText('时序图')
  await expect(dock(page).getByRole('button', { name: '定位' })).toBeVisible()
  await expect(dock(page).getByRole('button', { name: '时序图图例' })).toBeVisible()
  // 主语条右端也能收起；再按页头开关恢复，标签还在
  await dock(page).getByRole('button', { name: '收起视图区' }).click()
  await expect(dock(page)).toHaveCount(0)
  await viewsBtn(page).click()
  await expect(tabs(page)).toHaveCount(4)
})

test('LY-3：侧栏停靠——开关在竖栏顶格、挤压画布；宽度可拖（200–400）；开合与宽度按本机记住', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit')
  // ≥ 1440 缺省展开
  await expect(sidebar(page)).toBeVisible()
  const side0 = (await page.locator('.side-area').boundingBox())!
  expect(Math.round(side0.width)).toBe(240)
  const canvas0 = (await page.locator('.canvas-area').boundingBox())!
  // 竖栏 44 + 侧栏 240
  expect(Math.round(canvas0.x)).toBe(284)
  // 拖宽：右沿往右 80
  const handle = (await sidebar(page).locator('.resize').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + 200, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => Math.abs(Math.round((await page.locator('.side-area').boundingBox())!.width) - 320)).toBeLessThanOrEqual(2)
  // 拖过头夹在 400
  const h2 = (await sidebar(page).locator('.resize').boundingBox())!
  await page.mouse.move(h2.x + h2.width / 2, h2.y + 200)
  await page.mouse.down()
  await page.mouse.move(h2.x + 300, h2.y + 200, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await page.locator('.side-area').boundingBox())!.width)).toBe(400)
  // 收起：画布紧贴竖栏（竖栏还在）；重新打开页面仍收起（本机记住）
  await closeNav(page)
  expect(Math.round((await page.locator('.canvas-area').boundingBox())!.x)).toBe(44)
  await openDesk(page, '/p/media-web-player?level=kit')
  await expect(sidebar(page)).toHaveCount(0)
  await openSidebar(page)
  expect(Math.round((await page.locator('.side-area').boundingBox())!.width)).toBe(400)
})

test('G15、LY-8a、LY-4b：侧栏「按文件」的树中选中文件——地址带 sel=f:，视图区上组打开源代码预览标签；下一次单击替换它，双击标签固定', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const pick = (path: string, dbl = false) => pickFile(page, path, dbl)
  await pick('src/main.ts')
  expect(query(page).get('sel')).toBe('f:src/main.ts')
  await expect(docTabs(page)).toHaveCount(1)
  await expect(activeTab(page)).toContainText('main.ts')
  await expect(activeTab(page)).toHaveClass(/preview/)
  await expect(dock(page).locator('.source-view')).toContainText('createApp')

  // 下一次单击：替换预览，不堆积
  await pick('src/App.vue')
  await expect(docTabs(page)).toHaveCount(1)
  await expect(activeTab(page)).toContainText('App.vue')
  // 双击标签固定；再单击另一个文件：追加新的预览
  await activeTab(page).dblclick()
  await expect(activeTab(page)).not.toHaveClass(/preview/)
  await pick('src/main.ts')
  await expect(docTabs(page)).toHaveCount(2)
  await expect(docTabs(page).nth(0)).toContainText('App.vue')
  await expect(docTabs(page).nth(1)).toHaveClass(/preview/)
  // 文件树里双击：固定打开
  await pick('src/main.ts', true)
  await expect(docTabs(page).nth(1)).not.toHaveClass(/preview/)
  // 单独关闭一个资料标签；图解常驻没有 ×（LY-9）
  await dock(page).getByRole('button', { name: '关闭源代码 · main.ts' }).click()
  await expect(docTabs(page)).toHaveCount(1)
  await expect(viewTab(page, 'explainer').locator('.x')).toHaveCount(0)
})

test('LY-10a、LY-11、LY-9：场景排布上下两组，新资料进上组；视图标签常驻不可关，「+」打开的资料进发起的那一组', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  const groups = dock(page).locator('.group')
  await expect(groups).toHaveCount(2)
  await expect(groups.nth(0).locator('.seq-doc')).toBeVisible()
  await expect(activeTab(page, 1)).toHaveAttribute('data-view-tab', 'explainer')
  await pickFile(page, 'src/main.ts')
  await expect(groups.nth(0).locator('.tabs > .tab[data-doc="src:src/main.ts"]')).toHaveCount(1)
  // 源代码与描述同时可见
  await expect(groups.nth(0).locator('.source-view')).toBeVisible()
  await expect(groups.nth(1)).toBeVisible()
  // 视图标签与时序图常驻：没有关闭按钮
  await expect(dock(page).getByRole('button', { name: '关闭核对' })).toHaveCount(0)
  await expect(dock(page).getByRole('button', { name: '关闭时序图' })).toHaveCount(0)
  // 从下组的「+」打开「问题」：进下组并激活
  await groups.nth(1).getByRole('button', { name: '添加标签' }).click()
  await groups.nth(1).locator('[data-add-doc="issues"]').click()
  await expect(activeTab(page, 1)).toHaveAttribute('data-doc-tab', 'issues')
})

test('LY-8：选中与单步不改排布，视图标签内容随主语变；退出场景回到自由排布，资料标签留着', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await pickFile(page, 'src/main.ts')
  await expect(docTab(page, 'src:src/main.ts')).toHaveCount(1)
  const before = await tabIds(page)
  await page.getByRole('button', { name: /下一步/ }).click()
  // 图例展开时叠在画布右上，会盖住那里的节点（L48）
  await collapseDisplay(page)
  await graphNode(page, 'state.desk').click()
  // 标签集合不跟随选中
  expect(await tabIds(page)).toEqual(before)
  // 退出场景：自由排布（图解 描述 核对），时序图移出，源代码留着（LY-9a、LY-11b）
  await page.locator('[data-scene-chip]').getByRole('button', { name: '退出场景' }).click()
  await expect(viewTab(page, 'sequence')).toHaveCount(0)
  await expect(tabs(page)).toHaveCount(4)
  await expect(docTab(page, 'src:src/main.ts')).toHaveCount(1)
})
