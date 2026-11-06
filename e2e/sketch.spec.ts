/**
 * 草图（§6.13）：打开设计的草图、对比当前版本、「交给 AI」；故意制造偏差后问题页签出现「草图偏差」，认可后消失。
 * 偏差用加文件的方式制造（往 r4 快照里塞一个挂在封闭子树下的模块），结束后删掉；认可写进真实的 design.yaml，结束后恢复。
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { openDesk, restoreOwned, switchVersion, closeNav, openPanel } from './helpers'

const DESIGN = path.resolve(import.meta.dirname, '../model/h5p-arch-desk/designs/phase2-dynamic')
const EXTRA = path.join(DESIGN, 'r4/modules/zz-e2e-deviation.yaml')
const OWNED = path.resolve(import.meta.dirname, '../model/h5p-arch-desk/governance/owned.json')
const designYaml = path.join(DESIGN, 'design.yaml')

test.describe.configure({ mode: 'serial' })

test('DV-10：版本切换里草图排在 r1 之前；打开草图即草图画布（ADR-0025），信息条有「交给 AI」', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk/d/phase2-dynamic/r4')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  const options = await page.locator('select[aria-label="切换版本"] option').allTextContents()
  const r1 = options.findIndex(o => o.includes('· r1'))
  expect(options[r1 + 1]).toContain('✎')
  await switchVersion(page, 'phase2-dynamic/sketch')
  const bar = page.locator('.info-bar')
  await expect(bar.locator('.kind')).toHaveText('草图')
  await expect(page.locator('.sketch-canvas')).toBeVisible()
  await expect(page.locator('.sk-band')).toHaveCount(3)
  // 身份区：唯一一条面包屑（根草图只有一级）；对比区：六类计数，口径缺省相对基线
  await expect(bar.locator('.mount')).toContainText('挂在：')
  await expect(bar.locator('.cmp-btn')).toContainText('对比 相对基线')
  await expect(bar.getByRole('button', { name: '交给 AI', exact: true })).toBeVisible()
  await expect(page.locator('[data-testid="sketch-panel"]')).toBeVisible()
})

test('X4：r4 与草图一致；故意制造偏差（封闭子树多出子模块）后问题页签出现「草图偏差」error；认可提醒级偏差后它从问题页签消失', async ({ page }) => {
  const before = fs.readFileSync(designYaml, 'utf8')
  const owned = fs.readFileSync(OWNED, 'utf8')
  try {
    await openDesk(page, '/p/h5p-arch-desk/d/phase2-dynamic/r4')
    await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
    await expect(page.locator('.panel')).toContainText('与草图一致')

    fs.writeFileSync(EXTRA, 'modules:\n  - { id: model.scenario.e2e, name: E2E 多出来的, parent: model.scenario, responsibility: 只为核验 }\n')
    await page.getByRole('button', { name: /^⚠/ }).click()
    const item = page.locator('.issue-list .item', { hasText: '草图偏差' })
    await expect(item.first()).toContainText('封闭子树多出子模块')
    await expect(item.first()).toHaveClass(/error/)
    fs.rmSync(EXTRA)
    await expect(page.locator('.issue-list .item', { hasText: '草图偏差' })).toHaveCount(0)
    await closeNav(page) // 导航浮层盖着 ⚠ 胶囊，下一个动作在画布上

    // 提醒级偏差：r1 缺草图的接口 if.state.transition；在 r1 上认可它
    await openDesk(page, '/p/h5p-arch-desk/d/phase2-dynamic/r1')
    await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
    await page.getByRole('button', { name: /^⚠/ }).click()
    const warn = page.locator('.issue-list .item', { hasText: 'if.state.transition' })
    await expect(warn).toHaveCount(1)
    const form = page.locator('.panel .dev', { hasText: 'if.state.transition' })
    await form.getByRole('button', { name: '认可偏差（写理由）' }).click()
    await form.locator('textarea, input').fill('E2E：r1 还没有视图状态转移')
    await form.getByRole('button', { name: '写入' }).click()
    await expect(page.locator('.issue-list .item', { hasText: 'if.state.transition' })).toHaveCount(0)
    await expect(page.locator('.panel .dev', { hasText: 'if.state.transition' })).toContainText('已认可')
  } finally {
    if (fs.existsSync(EXTRA)) fs.rmSync(EXTRA)
    fs.writeFileSync(designYaml, before)
    restoreOwned(OWNED, owned, ['designs/phase2-dynamic/design.yaml'])
  }
})
