/**
 * 工具栏治理（TB-1–TB-11，ADR-0057，验收 6.42 第 1–4 条）：工具栏只有 8 组元素、图标统一；导航顶部的项目标题区与工具栏、
 * 资料区标签栏底线成一条横线，项目菜单切版本、编辑骨架、新建设计、所有项目；画布左上角是「根层 / …」、⚠、源码胶囊与版本胶囊；
 * ⌘K 打开搜索、选中结果后画布定位；「⋯」里有帮助与快捷键。
 */
import { expect, test, type Page } from '@playwright/test'
import { openDesk, openProjectMenu, query, switchVersion } from './helpers'

const bar = (page: Page) => page.getByRole('banner', { name: '工具栏' })
const dock = (page: Page) => page.getByRole('complementary', { name: '资料区' })
const title = (page: Page) => page.locator('.canvas-title')

test('验收 6.42 第 1 条（第二十轮 §4 改写）：顶栏拉通——项目菜单在栏首，其右是视角段与工具按钮；导航树是画布浮层抽屉，不再挤压任何栏（TB-1、TB-2）', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit')
  await page.getByRole('button', { name: '属性', exact: true }).click() // 抽屉缺省收起，打开后「专注」才是静息标签
  const names = await bar(page)
    .getByRole('button')
    .evaluateAll(els => els.map(e => e.getAttribute('aria-label') ?? e.textContent!.trim()))
  expect(names).toEqual(['项目菜单', '导航树', '结构', '交互', '运行 ▾', '显示 ▾', '搜索模块', '专注', '属性', '资料', '更多'])
  // 不再有面包屑与搜索框（版本下拉随项目菜单住进栏首）
  await expect(bar(page).locator('.crumbs')).toHaveCount(0)
  for (const name of ['导航树', '搜索模块', '专注', '属性', '资料', '更多']) {
    const svg = bar(page).getByRole('button', { name, exact: true }).locator('svg')
    await expect(svg).toHaveAttribute('width', '16')
    await expect(svg).toHaveAttribute('fill', 'none')
  }
  // 顶栏拉通：横跨包括资料区在内的整个窗口宽
  const barBox = (await bar(page).boundingBox())!
  const win = page.viewportSize()!
  expect(Math.abs(barBox.width - win.width)).toBeLessThanOrEqual(1)
  // 开着的浅色底：属性抽屉打开（无资料区时挤压画布）；导航抽屉缺省收起
  await expect(bar(page).getByRole('button', { name: '属性', exact: true })).toHaveClass(/\bon\b/)
  await expect(bar(page).getByRole('button', { name: '属性', exact: true })).toHaveAttribute('title', /当前挤压/)
  await expect(bar(page).getByRole('button', { name: '导航树', exact: true })).not.toHaveClass(/\bon\b/)

  await openDesk(page, '/p/media-web-player?level=kit&sc=sc.command')
  await expect(dock(page)).toBeVisible()
  const run = page.locator('.perspective .seg.run')
  const full = (await run.getAttribute('title'))!
  expect(full).toContain('命令（play / pause / stop / seek')
  // 视角段完整可见：段内不裁切；顶栏拉通后右侧按钮不再被资料区挤压
  expect(await run.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true)
  const more = (await bar(page).getByRole('button', { name: '更多' }).boundingBox())!
  expect(more.x + more.width).toBeLessThanOrEqual(barBox.x + barBox.width)
  // 展开导航树：浮层抽屉盖在画布左缘；顶栏拉通后右侧按钮贴窗口右沿、不被任何栏挤压
  await page.getByRole('button', { name: '导航树', exact: true }).click()
  await expect(page.locator('.nav-area')).toBeVisible()
  const more2 = (await bar(page).getByRole('button', { name: '更多' }).boundingBox())!
  expect(more2.x + more2.width).toBeLessThanOrEqual(barBox.x + barBox.width)
})

test('验收 6.42 第 2 条（第二十轮 §4 改写）：项目菜单住顶栏栏首，与资料区标签栏底线同高；资料区在顶栏之下通到底（TB-6、TB-10、TB-11）', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit&sc=sc.command')
  await expect(dock(page)).toBeVisible()
  const head = page.locator('.project-head')
  await expect(head).toBeVisible()
  await expect(head.getByRole('button', { name: '项目菜单' })).toContainText('media-platform Web 播放器')
  const bottom = async (sel: string) => {
    const b = (await page.locator(sel).first().boundingBox())!
    return b.y + b.height
  }
  // 顶栏（含项目菜单）底线一致；资料区从顶栏之下开始，标签栏紧贴其下
  const lines = [await bottom('.project-head'), await bottom('header.top')]
  expect(Math.max(...lines) - Math.min(...lines)).toBeLessThanOrEqual(0.5)
  const dockBox = (await dock(page).boundingBox())!
  expect(dockBox.y).toBe(44)
  expect(await bottom('.dock .tabs')).toBe(88)
  const divider = (await page.locator('.dock-divider').boundingBox())!
  expect(divider.y).toBe(44)
  expect(divider.height).toBe(900 - 44)
  // 标签栏右端：⊟ 分屏、× 全部关闭
  await expect(dock(page).getByRole('button', { name: '上下分屏' }).locator('svg')).toHaveCount(1)
  await expect(dock(page).getByRole('button', { name: '关闭资料区' }).locator('svg')).toHaveCount(1)
})

test('验收 6.42 第 2 条：项目菜单切版本（版本胶囊 × 回当前版本）、编辑骨架、新建设计、所有项目（TB-6、TB-9）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await openProjectMenu(page)
  const menu = page.getByRole('menu', { name: '项目' })
  await expect(menu.getByRole('menuitem')).toHaveText(['编辑骨架', '新建设计', '所有项目'])
  await expect(menu.locator('select[aria-label="切换版本"] optgroup[label^="已归档"] option').first()).toContainText('二期 · 动态视角')
  // 新建设计：对话框
  await menu.getByRole('menuitem', { name: '新建设计' }).click()
  await expect(menu).toBeHidden()
  const dialog = page.getByRole('dialog', { name: '新建设计' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).toHaveCount(0)

  // 切到一个设计版本：菜单收起，画布左上角出现版本胶囊，× 回到当前版本
  await switchVersion(page, 'phase2-dynamic/r4')
  await expect(page).toHaveURL(/\/d\/phase2-dynamic\/r4/)
  await expect(menu).toBeHidden()
  const chip = page.getByTestId('version-chip')
  await expect(chip).toContainText('二期 · 动态视角 · r4')
  // 非当前版本没有编辑骨架、新建设计
  await openProjectMenu(page)
  await expect(menu.getByRole('menuitem')).toHaveText(['所有项目'])
  await page.keyboard.press('Escape')
  // 导航树是画布左缘的浮层抽屉（openProjectMenu 会展开它）：盖住画布左上的版本胶囊，先收起
  if (await page.locator('.nav-area').isVisible()) await page.getByRole('button', { name: '导航树', exact: true }).click()
  await chip.getByRole('button', { name: '回到当前版本' }).click()
  await expect(page).toHaveURL(/#\/p\/h5p-arch-desk(\?|$)/)
  await expect(chip).toHaveCount(0)

  // 编辑骨架：进入持久草图
  await openProjectMenu(page)
  await menu.getByRole('menuitem', { name: '编辑骨架' }).click()
  await expect(page).toHaveURL(/\/i\/skeleton/)
  await expect(page.locator('.sketch-canvas')).toBeVisible()

  // 所有项目：回项目列表
  await openProjectMenu(page)
  await menu.getByRole('menuitem', { name: '所有项目' }).click()
  await expect(page).toHaveURL(/#\/$/)
})

test('验收 6.42 第 3 条：画布左上角是「根层 / …」、⚠、源码胶囊，不再有整行的源码提示条（TB-7、TB-8）', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit')
  const crumbs = title(page).locator('.crumbs')
  await expect(crumbs).toHaveText(/^根层\s*\/\s*播放器 Kit$/)
  await expect(crumbs.locator('.crumb').first()).toHaveAttribute('title', /media-platform Web 播放器/)
  await expect(title(page).locator('.issue-badge')).toHaveText(/⚠ \d+/)
  // 标题行贴着画布左上角
  const canvas = (await page.locator('.canvas-area').boundingBox())!
  const row = (await crumbs.boundingBox())!
  expect(row.x - canvas.x).toBeLessThan(20)
  expect(row.y - canvas.y).toBeLessThan(20)
  await expect(page.locator('.source-delta')).toHaveCount(0)
  // 源码胶囊：单击展开原文，再单击收起
  const chip = title(page).locator('.source-chip')
  await expect(chip).toHaveText(/^(描述落后 \d+ 个提交|描述的提交不在源码树中)$/)
  await chip.click()
  await expect(title(page).getByRole('status')).toContainText('描述基于')
  await chip.click()
  await expect(title(page).getByRole('status')).toHaveCount(0)
  // 面包屑返回根层
  await crumbs.locator('.crumb', { hasText: '根层' }).click()
  expect(query(page).get('level')).toBeNull()
  await expect(crumbs).toHaveText('根层')
})

test('验收 6.42 第 4 条：⌘K 打开搜索，选中结果后画布定位；Esc 关闭；「⋯」里有帮助与快捷键（TB-4、TB-5）', async ({ page }) => {
  await openDesk(page, '/p/media-web-player')
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: '搜索模块' })
  await expect(palette).toBeVisible()
  await expect(palette.getByRole('textbox', { name: '搜索模块' })).toBeFocused()
  // 面板在工具栏中央下拉
  const barBox = (await bar(page).boundingBox())!
  const pBox = (await palette.boundingBox())!
  expect(Math.abs(pBox.x + pBox.width / 2 - (barBox.x + barBox.width / 2))).toBeLessThan(2)
  expect(pBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height)
  await page.keyboard.type('会话内核')
  await expect(palette.locator('li').first()).toContainText('播放器 Kit')
  await page.keyboard.press('Enter')
  await expect(palette).toHaveCount(0)
  await expect.poll(() => query(page).get('sel')).toBe('m:kit.kernel')
  expect(query(page).get('level')).toBe('kit')
  // ⌕ 打开，Esc 关闭；再按 ⌘K 也关闭
  await bar(page).getByRole('button', { name: '搜索模块' }).click()
  await expect(palette).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette).toHaveCount(0)

  await bar(page).getByRole('button', { name: '更多' }).click()
  const more = page.getByRole('menu', { name: '更多' })
  await expect(more.getByRole('menuitem')).toHaveText([/怎么读这张图/, '快捷键'])
  await more.getByRole('menuitem', { name: '快捷键' }).click()
  const guide = page.getByRole('dialog', { name: '怎么读这张图' })
  await expect(guide.locator('[data-section="keys"]')).toBeInViewport()
  await expect(guide.locator('[data-section="keys"]')).toContainText('⌘K / Ctrl+K')
})
