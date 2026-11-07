/**
 * 边界与组装（ADR-0030、ADR-0039）：L14 边界角色压在框上边 / 左边；O12「组装」开关开启后出现组装叠加虚线（依赖方一端实心菱形，ADR-0035）与「组装根」角标，单击叠加线落到代码依赖；
 * R17 场景列表默认只列主流程，可切到全部类别。
 */
import { expect, test } from '@playwright/test'
import { graphNode, openDesk, query, openPanel } from './helpers'

test('L14：h5player 的对外 API 压在 PlayerIndex 框的上边，SW 通道（adapter）压在 Worker 基础设施框的左边（外部系统一侧）', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra.player-index')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  const api = (await graphNode(page, 'infra.player-index.player-api').boundingBox())!
  const stats = (await graphNode(page, 'infra.player-index.stats').boundingBox())!
  expect(api.y + api.height).toBeLessThan(stats.y)
  await expect(graphNode(page, 'infra.player-index.player-api').locator('.rim-tag')).toHaveText('端口')
  await openDesk(page, '/p/h5player?level=infra.workers')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  const sw = (await graphNode(page, 'infra.workers.sw-channel').boundingBox())!
  const task = (await graphNode(page, 'infra.workers.worker-task').boundingBox())!
  expect(sw.x + sw.width).toBeLessThan(task.x)
  await expect(graphNode(page, 'infra.workers.sw-channel').locator('.rim-tag')).toHaveText('适配器')
})

test('O12：「组装」开关缺省关；开启后出现组装叠加线与组装根角标，单击叠加线选中代码依赖；开关按项目记在本地、不进 URL', async ({ page }) => {
  await openDesk(page, '/p/h5player')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  const toggle = page.getByRole('switch', { name: '组装' })
  await expect(toggle).toBeEnabled()
  await expect(toggle).not.toBeChecked()
  await expect(page.locator('.vue-flow__edge[data-id^="asm:"]')).toHaveCount(0)
  await toggle.check()
  const overlays = page.locator('.vue-flow__edge[data-id^="asm:"]')
  await expect(overlays.first()).toBeAttached()
  expect(await overlays.count()).toBeGreaterThan(0)
  await expect(page.locator('.assembly-root').first()).toBeVisible()
  // L18：组装是依赖——虚线；依赖方一端实心菱形
  await expect(overlays.first().locator('path.vue-flow__edge-path')).toHaveCSS('stroke-dasharray', '6px, 4px')
  await expect(overlays.first().locator('path.vue-flow__edge-path')).toHaveAttribute('marker-start', /url\(#arrow-.+-start\)/)
  expect(page.url()).not.toContain('assembly')
  // 叠加线不参与布局、带标签的标 ×N：在标签上派发单击（同代码依赖叠加线）
  await page.locator('.vue-flow__edge[data-id^="asm:"] .vue-flow__edge-text').first().dispatchEvent('click')
  await expect.poll(() => query(page).get('sel')).toMatch(/^d:.+->.+$/)
  await expect(page.locator('.dep-panel')).toContainText('模块依赖')
  // 重新打开项目：本地记住的开关恢复
  await openDesk(page, '/p/h5player?level=infra')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  await expect(page.getByRole('switch', { name: '组装' })).toBeChecked()
})

test('R17：场景列表默认只列主流程，切到「全部类别」后出现异常类场景并标出类别', async ({ page }) => {
  // 真实描述里的场景都是主流程：把一个场景改成 exception 再看筛选（不改文件）
  await page.route('**/models/h5player.json', async route => {
    const res = await route.fetch()
    const body = (await res.json()) as { files: { path: string; text: string }[] }
    const files = body.files.map(f => (f.path === 'scenarios/timeshift-pause.yaml' ? { ...f, text: f.text.replace('  kind: main', '  kind: exception') } : f))
    await route.fulfill({ response: res, json: { ...body, files } })
  })
  await openDesk(page, '/p/h5player')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  await page.locator('[data-scene-chip]').click()
  const list = page.getByRole('dialog', { name: '选择场景' })
  await list.getByRole('group', { name: '范围' }).getByRole('button', { name: /全部/ }).click()
  const kinds = list.getByRole('group', { name: '类别' })
  await expect(kinds.getByRole('button', { name: /主流程/ })).toHaveClass(/on/)
  await expect(list.locator('.item', { hasText: '暂停后切时移' })).toHaveCount(0)
  await expect(list.locator('.item', { hasText: '命令执行' })).toHaveCount(1)
  await kinds.getByRole('button', { name: /全部类别/ }).click()
  const pause = list.locator('.item', { hasText: '暂停后切时移' })
  await expect(pause).toHaveCount(1)
  await expect(pause.locator('.kind-tag')).toHaveText('异常')
})
