/**
 * 架构治理（§6.10 第 5、6 条）：开启「代码事实」，只标异常——未证实的关系边为虚线并标 ?、已证实的不标；单击代码依赖叠加线看证据；根层面板有架构治理。
 * 本项目的描述已无未描述依赖，叠加线用 h5player 验证；h5player 源码不在本机时跳过。
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { openDesk, query } from './helpers'

/** 工作区根目录（同 vite/readSource 的 workspaceRoot；那里会连带加载 JSON 模块，Playwright 不支持） */
const WS = path.resolve(import.meta.dirname, '..', process.env.ARCH_WORKSPACE_ROOT ?? '../../..')
const H5PLAYER_LOCAL = fs.existsSync(path.join(WS, 'h5player'))

test('开启代码事实：未证实的边标 ?，已证实的不标 ✓（K9、L10）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await expect(page.locator('.panel')).toContainText('架构治理')
  await expect(page.locator('.panel')).toContainText(/已证实 \d+/)
  const toggle = page.locator('label.facts input')
  await expect(toggle).toBeEnabled()
  await toggle.check()
  await expect(page.locator('.edge-label-warn .vue-flow__edge-text', { hasText: '?' }).first()).toBeVisible()
  await expect(page.locator('.vue-flow__edge-text', { hasText: '✓' })).toHaveCount(0)
})

test('K5a：Layout 入口文件内概念子模块之间的关系，面板标「概念拆分，同文件」', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=state.layout.runner&sel=r:rel.ad.graph-boundaries')
  await expect(page.locator('.panel')).toContainText('不判定：概念拆分，同文件')
})

test('h5player：单击未描述依赖的叠加线选中它并显示代码依赖面板', async ({ page }) => {
  test.skip(!H5PLAYER_LOCAL, 'h5player 源码不在本机')
  await openDesk(page, '/p/h5player')
  await expect(page.locator('.panel')).toContainText('架构治理')
  await expect(page.locator('.panel')).toContainText(/已证实 \d+/)

  const toggle = page.locator('label.facts input')
  await expect(toggle).toBeEnabled()
  await toggle.check()
  await expect(page.locator('.vue-flow__edge-text', { hasText: '✓' })).toHaveCount(0)

  const overlay = page.locator('.vue-flow__edge-text', { hasText: '未描述' }).first()
  await expect(overlay).toBeVisible()
  // 叠加线的标签浮在边上，Playwright 的「稳定」判定会一直等待；h5player 根层节点密集，按坐标单击会落到节点上，这里直接在标签上派发单击
  await overlay.dispatchEvent('click')
  await expect.poll(() => query(page).get('sel')).toMatch(/^d:.+->.+$/)
  await expect(page.locator('.dep-panel')).toContainText('模块依赖')
})

test('运行视角下「显示」面板不出现「代码事实」开关（L9）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await page.getByRole('button', { name: /^显示/ }).click()
  await expect(page.getByRole('region', { name: '显示' })).toContainText('场景中显示全部节点与关系类型')
  await expect(page.locator('label.facts')).toHaveCount(0)
})
