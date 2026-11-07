/**
 * 回放主路径（LY-6、LY-11，第二十二轮波 4：运行视角并入交互）：回放 = 交互视角 + 一个场景，入口只有场景胶囊与侧栏「场景」页。
 * 从「场景 ▾」选场景 → ← → 逐步 → 单击「结构」即退出（LY-6a）→ 回到交互、从侧栏再进 → ✕ 退出；进出场景时视图区按情境排布，人改过的按情境记住。
 */
import { expect, test } from '@playwright/test'
import { activeTab, openDesk, query, sidebar, viewTab, views, waitSettled } from './helpers'

const seg = (page: import('@playwright/test').Page, mode: 'structure' | 'interaction') => page.locator(`[data-head="canvas"] [data-mode="${mode}"]`)
const chip = (page: import('@playwright/test').Page) => page.locator('[data-scene-chip]')
const position = (page: import('@playwright/test').Page) => page.locator('[data-head="views"] .id')

test('回放主路径：场景胶囊选场景 → ← → 逐步 → 切结构即退出 → 侧栏再进 → ✕ 退出；排布按情境，人改过的按情境记住', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await waitSettled(page)
  // 自由排布：上组〔图解 描述 核对〕，没有时序图
  await expect(viewTab(page, 'sequence')).toHaveCount(0)
  await expect(views(page).locator('.group')).toHaveCount(1)

  // 1. 「场景 ▾」下拉选场景：进入回放（交互视角 + 场景），视图区换成场景排布
  await chip(page).click()
  const list = page.getByRole('dialog', { name: '选择场景' })
  await list.getByRole('group', { name: '范围' }).getByRole('button', { name: /全部/ }).click()
  await list.locator('.item', { hasText: '打开场景并回放' }).click()
  await expect.poll(() => query(page).get('sc')).toBe('sc.open-and-play')
  await expect(chip(page)).toHaveClass(/\bon\b/)
  await expect(seg(page, 'interaction')).toHaveClass(/\bon\b/)
  await expect(activeTab(page, 0)).toHaveAttribute('data-view-tab', 'sequence')
  await expect(activeTab(page, 1)).toHaveAttribute('data-view-tab', 'description')
  await expect(page.locator('.player-bar')).toBeVisible()

  // 2. → → ←：逐步，主语条写进度，地址带 step
  await page.locator('[data-region="canvas"]').click({ position: { x: 20, y: 300 } })
  await page.keyboard.press('ArrowRight')
  await expect(position(page)).toHaveText(/^第 1 \//)
  await page.keyboard.press('ArrowRight')
  await expect(position(page)).toHaveText(/^第 2 \//)
  await page.keyboard.press('ArrowLeft')
  await expect(position(page)).toHaveText(/^第 1 \//)
  expect(query(page).get('step')).toBeTruthy()
  // 回放中单击「交互」无动作
  await seg(page, 'interaction').click()
  expect(query(page).get('sc')).toBe('sc.open-and-play')

  // 人改排布：关掉核对（场景情境记住）
  await views(page).getByRole('button', { name: '关闭核对' }).click()
  await expect(viewTab(page, 'check')).toHaveCount(0)

  // 3. 单击「结构」：退出场景并切到结构（LY-6a），视图区回到自由排布（核对还在——记忆按情境分）
  await seg(page, 'structure').click()
  await expect.poll(() => query(page).get('sc')).toBeNull()
  expect(query(page).get('v')).toBe('s')
  await expect(page.locator('.player-bar')).toHaveCount(0)
  await expect(viewTab(page, 'sequence')).toHaveCount(0)
  await expect(viewTab(page, 'check')).toHaveCount(1)
  // 再回交互
  await seg(page, 'interaction').click()
  await expect.poll(() => query(page).get('v')).toBeNull()

  // 4. 侧栏「场景」页再进：同一个场景，场景排布照人改过的（没有核对）
  await sidebar(page).locator('[data-side-page="scenes"]').click()
  await sidebar(page).getByRole('button', { name: /全部/ }).first().click()
  await sidebar(page).locator('.scenario-list .item', { hasText: '打开场景并回放' }).click()
  await expect.poll(() => query(page).get('sc')).toBe('sc.open-and-play')
  await expect(viewTab(page, 'sequence')).toHaveCount(1)
  await expect(viewTab(page, 'check')).toHaveCount(0)

  // 5. ✕ 退出：留在交互视角，自由排布
  await chip(page).getByRole('button', { name: '退出场景' }).click()
  await expect.poll(() => query(page).get('sc')).toBeNull()
  await expect(seg(page, 'interaction')).toHaveClass(/\bon\b/)
  await expect(viewTab(page, 'sequence')).toHaveCount(0)
  await expect(views(page).locator('.group')).toHaveCount(1)
  await expect(page.locator('.player-bar')).toHaveCount(0)
})
