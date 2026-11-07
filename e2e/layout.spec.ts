/**
 * 工作区布局（ADR-0054；第二十二轮 LY-8–LY-12，ADR-0064）：视图区常在（图解常驻）、按情境排布；资料标签预览替换与固定、进上组、不跟随主语；
 * 选中文件在视图区打开源代码（G15、§6.4）。选中抽屉与导航浮层是波 1 的过渡呈现（波 2 删）。
 */
import { expect, test, type Page } from '@playwright/test'
import { activeTab, collapseDisplay, docTab, docTabs, graphNode, openDesk, openPropsDrawer, query, viewTab, views } from './helpers'

const dock = views
const props = (page: Page) => page.getByRole('complementary', { name: '属性' })
const tabs = (page: Page) => dock(page).locator('.tabs > .tab')
const viewsBtn = (page: Page) => page.getByRole('button', { name: '资料', exact: true })
/** TB-2、WS-3：「▤ 属性」——并排还是悬浮写在它的悬停提示里 */
const propsBtn = (page: Page) => page.getByRole('button', { name: '属性', exact: true })

/** 文件页签里单击 / 双击一个文件（目录未展开时先展开） */
async function pickFile(page: Page, path: string, dbl = false) {
  const tab = page.getByRole('tab', { name: '文件' })
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
  const parts = path.split('/').slice(0, -1)
  for (let i = 1; i <= parts.length; i++) {
    const dir = page.locator(`.row.dir[data-dir="${parts.slice(0, i).join('/')}"]`)
    if ((await dir.locator('.caret').innerText()) === '▸') await dir.click()
  }
  const row = page.locator(`.row.file[data-path="${path}"]`)
  if (dbl) await row.dblclick()
  else await row.click()
}

test('LY-9、LY-12：视图区常在（图解常驻）、可整体收起；收起后抽屉挤压画布；回放中视图区按场景排布，抽屉不自动开合（LY-16）', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit')
  const bar = page.getByRole('banner', { name: '工具栏' })
  await expect(dock(page)).toBeVisible()
  await expect(activeTab(page)).toHaveAttribute('data-view-tab', 'explainer')
  // 收起视图区：画布满宽；抽屉拉开后挤压画布（不是悬浮）
  await viewsBtn(page).click()
  await expect(dock(page)).toHaveCount(0)
  await openPropsDrawer(page)
  await expect(propsBtn(page)).toHaveAttribute('title', /当前挤压/, { timeout: 15_000 })
  await expect(props(page)).not.toHaveClass(/floating/)
  await expect(page.locator('.nav-area')).toBeHidden() // 导航树是浮层抽屉，缺省收起
  await props(page).getByRole('button', { name: '关闭属性栏' }).click()

  // 视图区收起按本机记住（LY-12a）：同一页面换地址仍收起，再按展开
  await openDesk(page, '/p/media-web-player?level=kit&sc=sc.command')
  await expect(dock(page)).toHaveCount(0)
  await viewsBtn(page).click()
  await expect(dock(page)).toBeVisible()
  await expect(props(page)).toHaveCount(0)
  const barBox = (await bar.boundingBox())!
  const dockBox = (await dock(page).boundingBox())!
  const canvas = (await page.locator('.canvas-area').boundingBox())!
  // 顶栏拉通：横跨包括资料区在内的整个窗口宽；资料区从顶栏之下通到底
  expect(Math.abs(barBox.width - 1440)).toBeLessThanOrEqual(1)
  expect(dockBox.y).toBe(44)
  expect(canvas.width).toBeGreaterThanOrEqual(640)
  // 时序图标签（场景排布的上组激活）内容区顶部有「定位」「图例」（WS-10）
  await expect(activeTab(page, 0)).toHaveAttribute('data-view-tab', 'sequence')
  await expect(viewTab(page, 'sequence')).toContainText('时序图')
  await expect(dock(page).getByRole('button', { name: '定位' })).toBeVisible()
  await expect(dock(page).getByRole('button', { name: '时序图图例' })).toBeVisible()

  // 「▣」收起视图区：只剩画布；再按恢复，标签还在
  await viewsBtn(page).click()
  await expect(dock(page)).toHaveCount(0)
  await expect(page.locator('.canvas-area').boundingBox()).resolves.toMatchObject({ width: 1440 })
  await viewsBtn(page).click()
  await expect(tabs(page)).toHaveCount(4)
})

test('WS-2、WS-3（过渡）：视图区在时抽屉浮着、收起视图区后挤压；× 与「▤ 属性」关闭 / 打开；「专注」收起导航与抽屉再恢复', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit&sc=sc.command')
  await expect(dock(page)).toBeVisible()
  // 抽屉缺省收起；先手动打开
  await openPropsDrawer(page)
  await expect(props(page)).toBeVisible()
  // 资料区占 44%：抽屉挤压画布放不下 640 → 浮在画布右侧
  await expect(props(page)).toHaveClass(/floating/)
  // 隐藏资料区：宽度够了，抽屉回到挤压
  await page.getByRole('button', { name: '资料', exact: true }).click()
  await expect(props(page)).not.toHaveClass(/floating/)

  await props(page).getByRole('button', { name: '关闭属性栏' }).click()
  await expect(props(page)).toHaveCount(0)
  await expect(propsBtn(page)).not.toHaveAttribute('title', /当前/)
  // 换选中不重新打开
  await page.locator('.vue-flow__node-module').first().click()
  await expect(props(page)).toHaveCount(0)
  await propsBtn(page).click()
  await expect(props(page)).toBeVisible()

  // 专注：导航浮层与抽屉都收起；退出恢复
  await page.getByRole('button', { name: '导航树', exact: true }).click()
  await expect(page.locator('.nav-area')).toBeVisible()
  await page.getByRole('button', { name: '专注', exact: true }).click()
  await expect(props(page)).toHaveCount(0)
  await expect(page.locator('.nav-area')).toBeHidden()
  await page.getByRole('button', { name: '退出专注' }).click()
  await expect(props(page)).toBeVisible()
  await expect(page.locator('.nav-area')).toBeVisible()
})

test('G15、LY-8a：文件页签中选中文件——地址带 sel=f:，视图区上组打开源代码预览标签；下一次单击替换它，双击标签固定', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await page.getByRole('button', { name: '导航树', exact: true }).click() // 导航树浮层抽屉缺省收起
  const pick = async (path: string, dbl = false) => {
    // 点外即收：动过资料区之后导航浮层可能已收起，再打开
    if (!(await page.locator('.nav-area').isVisible())) await page.getByRole('button', { name: '导航树', exact: true }).click()
    await pickFile(page, path, dbl)
  }
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

test('LY-10a、LY-11、LY-9：场景排布上下两组，新资料进上组；描述可关、从「+」再开（进发起的那一组）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  const groups = dock(page).locator('.group')
  await expect(groups).toHaveCount(2)
  await expect(groups.nth(0).locator('.seq-doc')).toBeVisible()
  await expect(activeTab(page, 1)).toHaveAttribute('data-view-tab', 'description')
  await page.getByRole('button', { name: '导航树', exact: true }).click()
  await pickFile(page, 'src/main.ts')
  await expect(groups.nth(0).locator('.tabs > .tab[data-doc="src:src/main.ts"]')).toHaveCount(1)
  // 源代码与描述同时可见
  await expect(groups.nth(0).locator('.source-view')).toBeVisible()
  await expect(groups.nth(1)).toBeVisible()
  // 关掉核对，再从「+」加回
  await dock(page).getByRole('button', { name: '关闭核对' }).click()
  await expect(viewTab(page, 'check')).toHaveCount(0)
  await groups.nth(0).getByRole('button', { name: '添加标签' }).click()
  await groups.nth(0).locator('[data-add-view="check"]').click()
  await expect(activeTab(page, 0)).toHaveAttribute('data-view-tab', 'check')
})

test('LY-8：选中与单步不改排布，视图标签内容随主语变；退出场景回到自由排布，资料标签留着', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await page.getByRole('button', { name: '导航树', exact: true }).click()
  await pickFile(page, 'src/main.ts')
  await expect(docTab(page, 'src:src/main.ts')).toHaveCount(1)
  const before = await tabs(page).allInnerTexts()
  await expect(props(page)).toHaveCount(0)
  await page.getByRole('button', { name: /下一步/ }).click()
  // 图例展开时叠在画布右上，会盖住那里的节点（L48）
  await collapseDisplay(page)
  await graphNode(page, 'state.desk').click()
  // 标签集合不跟随选中
  expect(await tabs(page).allInnerTexts()).toEqual(before)
  // 退出场景：自由排布（图解 描述 核对），时序图移出，源代码留着（LY-9a、LY-11b）
  await page.locator('.perspective .exit').click()
  await expect(viewTab(page, 'sequence')).toHaveCount(0)
  await expect(tabs(page)).toHaveCount(4)
  await expect(docTab(page, 'src:src/main.ts')).toHaveCount(1)
})
