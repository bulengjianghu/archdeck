/**
 * 画布页头与画布左上角（LY-5，ADR-0064；TB-4–TB-9 的内容不变）：页头元素与图标统一；项目菜单（侧栏顶上）切版本、编辑骨架、新建设计、所有项目；
 * 面包屑在画布页头，⚠、源码胶囊与版本胶囊在画布左上角；⌘K 打开搜索、选中结果后画布定位；「⋯」里有帮助与快捷键。
 * 三区页头同高、底线对齐与选中不改宽度（LY-2、I3、I6）见 system-views.spec。
 */
import { expect, test, type Page } from '@playwright/test'
import { openDesk, openProjectMenu, query, switchVersion } from './helpers'

const head = (page: Page) => page.locator('[data-head="canvas"]')
const title = (page: Page) => page.locator('.canvas-title')

test('验收 6.44（LY-5，取代 6.42 第 1 条）：画布页头——侧栏开关、面包屑、视角段「结构 ｜ 交互」、场景胶囊、显示 ▾、⌕、⋯、视图区开关；没有全宽顶栏（LY-1）', async ({
  page,
}) => {
  await openDesk(page, '/p/media-web-player?level=kit')
  await expect(page.getByRole('banner', { name: '工具栏' })).toHaveCount(0)
  const names = await head(page)
    .getByRole('button')
    .evaluateAll(els => els.filter(e => !e.closest('.crumbs')).map(e => e.getAttribute('aria-label') ?? e.textContent!.trim()))
  expect(names).toEqual(['侧栏', '结构', '交互', '场景', '显示 ▾', '搜索模块', '更多', '视图区'])
  await expect(head(page).locator('.crumbs')).toHaveText(/^根层\s*\/\s*播放器 Kit$/)
  for (const name of ['侧栏', '搜索模块', '更多', '视图区']) {
    const svg = head(page).getByRole('button', { name, exact: true }).locator('svg')
    await expect(svg).toHaveAttribute('width', '16')
    await expect(svg).toHaveAttribute('fill', 'none')
  }
  // 开着的浅色底：视图区开着；侧栏的开合按窗口（≥ 1440 缺省展开，LY-3）
  await expect(head(page).getByRole('button', { name: '视图区', exact: true })).toHaveClass(/\bon\b/)
  await expect(head(page).getByRole('button', { name: '侧栏', exact: true })).toHaveClass(/\bon\b/)

  // 回放中：场景胶囊写场景名（≤ 12 字、悬停看全名）带 ✕；「交互」为按下态（回放 = 交互 + 场景，LY-6）
  await openDesk(page, '/p/media-web-player?level=kit&sc=sc.command')
  const chip = page.locator('[data-scene-chip]')
  await expect(chip).toHaveClass(/\bon\b/)
  expect(await chip.getAttribute('title')).toContain('命令（play / pause / stop / seek')
  await expect(head(page).locator('[data-mode="interaction"]')).toHaveClass(/\bon\b/)
  await expect(chip.getByRole('button', { name: '退出场景' })).toBeVisible()
  // 页头放得下：视图区开关贴着画布列右沿，不被挤出
  const h = (await head(page).boundingBox())!
  const v = (await head(page).getByRole('button', { name: '视图区', exact: true }).boundingBox())!
  expect(v.x + v.width).toBeLessThanOrEqual(h.x + h.width)
})

test('LY-5：「场景 ▾」下拉场景列表，选定即进入回放；✕ 退出场景留在交互视角（LY-6a）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await page.locator('[data-scene-chip]').click()
  const list = page.getByRole('dialog', { name: '选择场景' })
  await list.getByRole('group', { name: '范围' }).getByRole('button', { name: /全部/ }).click()
  await list.locator('.item', { hasText: '打开场景并回放' }).click()
  await expect(list).toHaveCount(0)
  await expect.poll(() => query(page).get('sc')).toBe('sc.open-and-play')
  await page.locator('[data-scene-chip]').getByRole('button', { name: '退出场景' }).click()
  await expect.poll(() => query(page).get('sc')).toBeNull()
  await expect(head(page).locator('[data-mode="interaction"]')).toHaveClass(/\bon\b/)
})

test('验收 6.42 第 2 条：项目菜单切版本（版本胶囊 × 回当前版本）、编辑骨架、新建设计、所有项目（TB-6、TB-9）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await openProjectMenu(page)
  const menu = page.getByRole('menu', { name: '项目' })
  await expect(menu.getByRole('menuitem')).toHaveText(['编辑骨架', '新建设计', '所有项目'])
  await expect(menu.locator('select[aria-label="切换版本"] optgroup[label^="已归档"] option', { hasText: '二期 · 动态视角' })).not.toHaveCount(0)
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

test('验收 6.42 第 3 条（LY-5 改写）：面包屑在画布页头，画布左上角是 ⚠、源码胶囊，不再有整行的源码提示条（TB-7、TB-8）', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit')
  const crumbs = head(page).locator('.crumbs')
  await expect(crumbs).toHaveText(/^根层\s*\/\s*播放器 Kit$/)
  await expect(crumbs.locator('.crumb').first()).toHaveAttribute('title', /media-platform Web 播放器/)
  await expect(title(page).locator('.issue-badge')).toHaveText(/⚠ \d+/)
  // 胶囊贴着画布左上角
  const canvas = (await page.locator('.canvas-area').boundingBox())!
  const row = (await title(page).locator('.issue-badge').boundingBox())!
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
  // 面板在画布页头中央下拉
  const barBox = (await head(page).boundingBox())!
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
  await head(page).getByRole('button', { name: '搜索模块' }).click()
  await expect(palette).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette).toHaveCount(0)

  await head(page).getByRole('button', { name: '更多' }).click()
  const more = page.getByRole('menu', { name: '更多' })
  await expect(more.getByRole('menuitem')).toHaveText([/怎么读这张图/, '快捷键'])
  await more.getByRole('menuitem', { name: '快捷键' }).click()
  const guide = page.getByRole('dialog', { name: '怎么读这张图' })
  await expect(guide.locator('[data-section="keys"]')).toBeInViewport()
  await expect(guide.locator('[data-section="keys"]')).toContainText('⌘K / Ctrl+K')
})
