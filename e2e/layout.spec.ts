/**
 * 工作区布局（R2、WS-1–WS-10，ADR-0054）：工具栏只属于工作列；属性栏按宽度并排或悬浮；资料区多标签、预览替换与固定、上下分屏、不跟随选中；
 * 选中文件在资料区打开源代码（G15、§6.4）
 */
import { expect, test, type Page } from '@playwright/test'
import { collapseDisplay, graphNode, openDesk, query } from './helpers'

const dock = (page: Page) => page.getByRole('complementary', { name: '资料区' })
const props = (page: Page) => page.getByRole('complementary', { name: '属性' })
const tabs = (page: Page) => dock(page).locator('.tabs > .tab')

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

test('WS-1、WS-3：工具栏只在工作列顶部、与资料区标签栏同高；开场景后属性栏由并排变悬浮，画布仍 ≥ 620px，导航树收起', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit')
  const bar = page.getByRole('banner', { name: '工具栏' })
  await expect(page.locator('.mode')).toHaveText('并排')
  await expect(props(page)).not.toHaveClass(/floating/)
  await expect(page.locator('.nav-area')).toBeVisible()

  await openDesk(page, '/p/media-web-player?level=kit&sc=sc.command')
  await expect(dock(page)).toBeVisible()
  await expect(page.locator('.mode')).toHaveText('悬浮')
  await expect(props(page)).toHaveClass(/floating/)
  await expect(page.locator('.nav-area')).toBeHidden()
  const barBox = (await bar.boundingBox())!
  const tabBox = (await dock(page).locator('.tabs').first().boundingBox())!
  const dockBox = (await dock(page).boundingBox())!
  const canvas = (await page.locator('.canvas-area').boundingBox())!
  // 工具栏不横跨资料区；资料区从顶到底，标签栏与工具栏同高
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(dockBox.x)
  expect(dockBox.y).toBe(0)
  expect(Math.abs(tabBox.height - barBox.height)).toBeLessThanOrEqual(1)
  expect(canvas.width).toBeGreaterThanOrEqual(620)
  // 悬浮卡片盖在画布上，不挤画布
  const propsBox = (await props(page).boundingBox())!
  expect(propsBox.x + propsBox.width).toBeLessThanOrEqual(canvas.x + canvas.width)
  // 时序图标签内容区顶部有「定位」「图例」（WS-10）
  await expect(tabs(page).first()).toContainText('时序图 · ')
  await expect(dock(page).getByRole('button', { name: '定位' })).toBeVisible()
  await expect(dock(page).getByRole('button', { name: '时序图图例' })).toBeVisible()

  // 「▣ 资料」隐藏资料区：属性栏回到并排；再按恢复，标签还在
  await page.getByRole('button', { name: '▣ 资料' }).click()
  await expect(dock(page)).toHaveCount(0)
  await expect(page.locator('.mode')).toHaveText('并排')
  await page.getByRole('button', { name: '▣ 资料' }).click()
  await expect(tabs(page)).toHaveCount(1)
  await expect(page.locator('.mode')).toHaveText('悬浮')
})

test('WS-2、WS-3、WS-9：窗口变窄自动悬浮；× 与「▤ 属性」关闭 / 打开；「专注」收起导航与属性栏再恢复', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit')
  await expect(page.locator('.mode')).toHaveText('并排')
  await page.setViewportSize({ width: 1100, height: 900 })
  await expect(page.locator('.mode')).toHaveText('悬浮')
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('.mode')).toHaveText('并排')

  await props(page).getByRole('button', { name: '关闭属性栏' }).click()
  await expect(props(page)).toHaveCount(0)
  await expect(page.locator('.mode')).toHaveCount(0)
  // 换选中不重新打开
  await page.locator('.vue-flow__node-module').first().click()
  await expect(props(page)).toHaveCount(0)
  await page.getByRole('button', { name: '▤ 属性' }).click()
  await expect(props(page)).toBeVisible()

  await page.getByRole('button', { name: '专注' }).click()
  await expect(props(page)).toHaveCount(0)
  await expect(page.locator('.nav-area')).toBeHidden()
  await page.getByRole('button', { name: '退出专注' }).click()
  await expect(props(page)).toBeVisible()
  await expect(page.locator('.nav-area')).toBeVisible()
})

test('G15、WS-5：文件页签中选中文件——地址带 sel=f:，资料区打开源代码预览标签；下一次单击替换它，双击标签固定', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await pickFile(page, 'src/main.ts')
  expect(query(page).get('sel')).toBe('f:src/main.ts')
  await expect(tabs(page)).toHaveCount(1)
  await expect(dock(page).locator('.tab.on')).toContainText('main.ts')
  await expect(dock(page).locator('.tab.on')).toHaveClass(/preview/)
  await expect(dock(page).locator('.source-view')).toContainText('createApp')

  // 下一次单击：替换预览，不堆积
  await pickFile(page, 'src/App.vue')
  await expect(tabs(page)).toHaveCount(1)
  await expect(dock(page).locator('.tab.on')).toContainText('App.vue')
  // 双击标签固定；再单击另一个文件：追加新的预览
  await dock(page).locator('.tab.on').dblclick()
  await expect(dock(page).locator('.tab.on')).not.toHaveClass(/preview/)
  await pickFile(page, 'src/main.ts')
  await expect(tabs(page)).toHaveCount(2)
  await expect(tabs(page).nth(0)).toContainText('App.vue')
  await expect(tabs(page).nth(1)).toHaveClass(/preview/)
  // 文件树里双击：固定打开
  await pickFile(page, 'src/main.ts', true)
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
  await dock(page).getByRole('button', { name: '⊟ 分屏' }).click()
  const groups = dock(page).locator('.group')
  await expect(groups).toHaveCount(2)
  await page.getByRole('button', { name: '展开导航树' }).click()
  await pickFile(page, 'src/main.ts')
  await expect(groups.nth(1).locator('.tabs > .tab')).toContainText('main.ts')
  await expect(groups.nth(0).locator('.tabs > .tab')).toContainText('时序图')
  // 时序图与源代码同时可见
  await expect(groups.nth(0).locator('.seq-doc')).toBeVisible()
  await expect(groups.nth(1).locator('.source-view')).toBeVisible()
  // 单击上组即聚焦，下一份进上组
  await groups
    .nth(0)
    .locator('.tabs')
    .click({ position: { x: 300, y: 10 } })
  await pickFile(page, 'src/App.vue')
  await expect(groups.nth(0).locator('.tabs > .tab')).toHaveCount(2)
  await dock(page).getByRole('button', { name: '取消分屏' }).click()
  await expect(groups).toHaveCount(1)
  await expect(tabs(page)).toHaveCount(3)
})

test('WS-8：资料区不跟随选中——选中画布节点、单步只改属性栏；退出场景关闭时序图标签', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await page.getByRole('button', { name: '展开导航树' }).click()
  await pickFile(page, 'src/main.ts')
  await expect(tabs(page)).toHaveCount(2)
  const before = await tabs(page).allInnerTexts()
  const active = await dock(page).locator('.tab.on').innerText()
  const head = props(page).locator('h2').first()
  const was = await head.innerText()
  await page.getByRole('button', { name: /下一步/ }).click()
  // 图例展开时叠在画布右上，会盖住那里的节点（L48）
  await collapseDisplay(page)
  await graphNode(page, 'state.desk').click()
  await expect(head).not.toHaveText(was)
  expect(await tabs(page).allInnerTexts()).toEqual(before)
  await expect(dock(page).locator('.tab.on')).toHaveText(active)
  // 退出场景：时序图标签关闭，源代码留着
  await page.locator('.perspective .exit').click()
  await expect(tabs(page)).toHaveCount(1)
  await expect(tabs(page).first()).toContainText('main.ts')
})
