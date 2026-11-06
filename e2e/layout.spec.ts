/**
 * 工作区布局（R2、WS-1–WS-10，ADR-0054）：工具栏只属于工作列；属性栏按宽度并排或悬浮；资料区多标签、预览替换与固定、上下分屏、不跟随选中；
 * 选中文件在资料区打开源代码（G15、§6.4）
 */
import { expect, test, type Page } from '@playwright/test'
import { collapseDisplay, graphNode, openDesk, openPropsDrawer, query } from './helpers'

const dock = (page: Page) => page.getByRole('complementary', { name: '资料区' })
const props = (page: Page) => page.getByRole('complementary', { name: '属性' })
const tabs = (page: Page) => dock(page).locator('.tabs > .tab')
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

test('WS-1、WS-3（第二十轮 §4 改写）：顶栏拉通在双栏之上；选中面板宽度够时挤压画布、进运行视角自动收起（步骤节归辅助栏），画布仍 ≥ 640px', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit')
  const bar = page.getByRole('banner', { name: '工具栏' })
  // 抽屉缺省收起；拉开后无资料区 → 挤压画布（不是悬浮）
  await openPropsDrawer(page)
  await expect(propsBtn(page)).toHaveAttribute('title', /当前挤压/, { timeout: 15_000 })
  await expect(props(page)).not.toHaveClass(/floating/)
  await expect(page.locator('.nav-area')).toBeHidden() // 导航树是浮层抽屉，缺省收起

  await openDesk(page, '/p/media-web-player?level=kit&sc=sc.command')
  await expect(dock(page)).toBeVisible()
  // 运行视角：抽屉自动收起（这次怎么走 + 步骤节都在辅助栏）
  await expect(props(page)).toHaveCount(0)
  await expect(propsBtn(page)).not.toHaveAttribute('title', /当前/)
  const barBox = (await bar.boundingBox())!
  const dockBox = (await dock(page).boundingBox())!
  const canvas = (await page.locator('.canvas-area').boundingBox())!
  // 顶栏拉通：横跨包括资料区在内的整个窗口宽；资料区从顶栏之下通到底
  expect(Math.abs(barBox.width - 1440)).toBeLessThanOrEqual(1)
  expect(dockBox.y).toBe(44)
  expect(canvas.width).toBeGreaterThanOrEqual(640)
  // 时序图标签内容区顶部有「定位」「图例」（WS-10）
  await expect(tabs(page).first()).toContainText('时序图 · ')
  await expect(dock(page).getByRole('button', { name: '定位' })).toBeVisible()
  await expect(dock(page).getByRole('button', { name: '时序图图例' })).toBeVisible()

  // 「▣ 资料」隐藏资料区：双栏只剩画布；再按恢复，标签还在
  await page.getByRole('button', { name: '资料', exact: true }).click()
  await expect(dock(page)).toHaveCount(0)
  await expect(page.locator('.canvas-area').boundingBox()).resolves.toMatchObject({ width: 1440 })
  await page.getByRole('button', { name: '资料', exact: true }).click()
  await expect(tabs(page)).toHaveCount(1)
})

test('WS-2、WS-3、WS-9（第二十轮 §4 改写）：资料区在时抽屉浮着、隐藏资料区后挤压；× 与「▤ 属性」关闭 / 打开；「专注」收起导航与抽屉再恢复', async ({
  page,
}) => {
  await openDesk(page, '/p/media-web-player?level=kit&sc=sc.command')
  await expect(dock(page)).toBeVisible()
  // 运行视角抽屉被自动收起；先手动打开
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

test('G15、WS-5：文件页签中选中文件——地址带 sel=f:，资料区打开源代码预览标签；下一次单击替换它，双击标签固定', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await page.getByRole('button', { name: '导航树', exact: true }).click() // 导航树浮层抽屉缺省收起
  const pick = async (path: string, dbl = false) => {
    // 点外即收：动过资料区之后导航浮层可能已收起，再打开
    if (!(await page.locator('.nav-area').isVisible())) await page.getByRole('button', { name: '导航树', exact: true }).click()
    await pickFile(page, path, dbl)
  }
  await pick('src/main.ts')
  expect(query(page).get('sel')).toBe('f:src/main.ts')
  await expect(tabs(page)).toHaveCount(1)
  await expect(dock(page).locator('.tab.on')).toContainText('main.ts')
  await expect(dock(page).locator('.tab.on')).toHaveClass(/preview/)
  await expect(dock(page).locator('.source-view')).toContainText('createApp')

  // 下一次单击：替换预览，不堆积
  await pick('src/App.vue')
  await expect(tabs(page)).toHaveCount(1)
  await expect(dock(page).locator('.tab.on')).toContainText('App.vue')
  // 双击标签固定；再单击另一个文件：追加新的预览
  await dock(page).locator('.tab.on').dblclick()
  await expect(dock(page).locator('.tab.on')).not.toHaveClass(/preview/)
  await pick('src/main.ts')
  await expect(tabs(page)).toHaveCount(2)
  await expect(tabs(page).nth(0)).toContainText('App.vue')
  await expect(tabs(page).nth(1)).toHaveClass(/preview/)
  // 文件树里双击：固定打开
  await pick('src/main.ts', true)
  await expect(tabs(page).nth(1)).not.toHaveClass(/preview/)
  // 单独关闭一个标签；✕ 关闭整个资料区
  await dock(page).getByRole('button', { name: '关闭源代码 · main.ts' }).click()
  await expect(tabs(page)).toHaveCount(1)
  await dock(page).getByRole('button', { name: '关闭资料区' }).click()
  await expect(dock(page)).toHaveCount(0)
})

test('WS-6：分屏后新资料进下组，上下对照；单击上组后进上组；取消分屏并回', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await expect(tabs(page)).toHaveCount(1)
  await dock(page).getByRole('button', { name: '上下分屏' }).click()
  const groups = dock(page).locator('.group')
  await expect(groups).toHaveCount(2)
  await page.getByRole('button', { name: '导航树', exact: true }).click()
  await pickFile(page, 'src/main.ts')
  await expect(groups.nth(1).locator('.tabs > .tab')).toContainText('main.ts')
  if (!(await page.locator('.nav-area').isVisible())) await page.getByRole('button', { name: '导航树', exact: true }).click()
  if ((await page.locator('.nav-area [role="tab"]').count()) === 0) await page.getByRole('button', { name: '导航树', exact: true }).click()
  await expect(groups.nth(0).locator('.tabs > .tab')).toContainText('时序图')
  // 时序图与源代码同时可见
  await expect(groups.nth(0).locator('.seq-doc')).toBeVisible()
  await expect(groups.nth(1).locator('.source-view')).toBeVisible()
  // 单击上组即聚焦，下一份进上组
  await groups
    .nth(0)
    .locator('.tabs')
    .click({ position: { x: 300, y: 10 } })
  if (!(await page.locator('.nav-area').isVisible())) await page.getByRole('button', { name: '导航树', exact: true }).click()
  if (!(await page.locator('.nav-area').isVisible())) await page.getByRole('button', { name: '导航树', exact: true }).click()
  await pickFile(page, 'src/App.vue')
  await expect(groups.nth(0).locator('.tabs > .tab')).toHaveCount(2)
  await dock(page).getByRole('button', { name: '取消分屏' }).click()
  await expect(groups).toHaveCount(1)
  await expect(tabs(page)).toHaveCount(3)
})

test('WS-8（第二十轮 §4 改写）：资料区不跟随选中——选中画布节点、单步只改属性栏与步骤节；退出场景关闭时序图标签、抽屉恢复', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await page.getByRole('button', { name: '导航树', exact: true }).click()
  await pickFile(page, 'src/main.ts')
  await expect(tabs(page)).toHaveCount(2)
  const before = await tabs(page).allInnerTexts()
  // 运行视角：抽屉被自动收起，步骤节在辅助栏（点文件后激活的是源代码标签，点回时序图）
  await expect(props(page)).toHaveCount(0)
  await page.getByRole('button', { name: /下一步/ }).click()
  // 图例展开时叠在画布右上，会盖住那里的节点（L48）
  await collapseDisplay(page)
  await graphNode(page, 'state.desk').click()
  // WS-8 本体：标签集合不跟随选中（时序图作为运行主文档被激活不算）
  expect(await tabs(page).allInnerTexts()).toEqual(before)
  // 退出场景：时序图标签关闭、步骤节消失，源代码留着；抽屉恢复到运行前的状态
  await page.locator('.perspective .exit').click()
  await expect(tabs(page)).toHaveCount(1)
  await expect(tabs(page).first()).toContainText('main.ts')
})
