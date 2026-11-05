/** 运行视角的统一选中（§6.8、ADR-0012）：选中样式唯一、配对标记、泳道突出、进度小标记、Esc 回到进度所在的步骤、再按无动作 */
import { expect, test } from '@playwright/test'
import { closeNav, collapseDisplay, graphNode, openDesk, openPanel, openPropsDrawer, query } from './helpers'

/** 第二十轮 §4：运行视角抽屉自动收起，步骤详情住辅助栏的步骤节（V6 新家） */

const HOOK = '/p/h5player?level=infra.framework&sc=sc.command&alt=1&step=sc.command%23hook'

test('选中步骤：只有它用选中样式，配对的返回只加「配对」标记，不突出泳道；面板是步骤面板', async ({ page }) => {
  await openDesk(page, HOOK)
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  await expect(page.locator('.msg.selected')).toHaveCount(1)
  await expect(page.locator('.msg.selected')).toContainText('pre / post hook')
  await expect(page.locator('.msg.paired')).toHaveCount(1)
  await expect(page.locator('.msg.paired .pair-tag')).toContainText('配对')
  await expect(page.locator('.lane.emph')).toHaveCount(0)
  await expect(page.locator('.panel')).toContainText('选中的步骤')
  await expect(page.locator('.panel')).not.toContainText('已钉住')
  // 结构图：选中步骤时其余走过的步骤序号变灰
  await expect(page.locator('.vue-flow__node-step .n.muted').first()).toBeVisible()
})

test('选中模块：突出它所在的泳道、不突出消息，进度只剩小标记，结构图不变灰；sel 与 step 并存', async ({ page }) => {
  await openDesk(page, HOOK)
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  // 展开的图例叠在画布右上，合入 X1 后画布变高、适应放大，这个节点落在图例下面（L48）：先收起图例再点
  await collapseDisplay(page)
  await graphNode(page, 'infra.framework.state-machine').click()
  expect(query(page).get('sel')).toBe('m:infra.framework.state-machine')
  expect(query(page).get('step')).toBe('sc.command#hook')
  // 顶部与底部两份泳道头
  await expect(page.locator('.lane.emph')).toHaveCount(2)
  await expect(page.locator('.lane.emph').first()).toContainText('状态机')
  await expect(page.locator('.lifeline.emph')).toHaveCount(1)
  await expect(page.locator('.msg.selected')).toHaveCount(0)
  await expect(page.locator('.num .progress')).toHaveCount(1)
  await expect(page.locator('.vue-flow__node-step .n.muted')).toHaveCount(0)
  await expect(page.locator('.panel')).not.toContainText('已钉住')
})

test('Esc 回到选中进度所在的步骤，再按无动作（N9）；「下一步」从进度处继续并选中下一步', async ({ page }) => {
  await openDesk(page, HOOK)
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  // 展开的图例叠在画布右上，合入 X1 后画布变高、适应放大，这个节点落在图例下面（L48）：先收起图例再点
  await collapseDisplay(page)
  await graphNode(page, 'infra.framework.state-machine').click()
  await page.keyboard.press('Escape')
  expect(query(page).get('sel')).toBeNull()
  await expect(page.locator('.msg.selected')).toContainText('pre / post hook')
  // 已是进度所在的步骤：再按 Esc 无动作，不返回上级（N9）
  const level = query(page).get('level')
  await page.keyboard.press('Escape')
  expect(query(page).get('level')).toBe(level)
  await expect(page.locator('.msg.selected')).toContainText('pre / post hook')

  await graphNode(page, 'infra.framework.state-machine').click()
  const before = (await page.locator('.num:has(.progress)').textContent()) ?? ''
  await page.locator('.player button.next').click()
  await expect(page.locator('.msg.selected')).toHaveCount(1)
  const after = (await page.locator('.msg.selected .num').textContent()) ?? ''
  expect(Number(after)).toBe(Number(before.replace(/\D/g, '')) + 1)
  expect(query(page).get('sel')).toBeNull()
})

test('打开场景选中场景：面板是场景概览，地址没有 sel 与 step；按 → 选中第 1 步', async ({ page }) => {
  await openDesk(page, '/p/h5player')
  await page.goto('./#/p/h5player?sc=sc.command')
  // 运行视角自动收起抽屉：拉开后看场景概览
  await openPanel(page)
  await expect(page.locator('.panel')).toContainText('触发')
  expect(query(page).get('step')).toBeNull()
  await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.msg.selected .num')).toHaveText('1')
  expect(query(page).get('step')).not.toBeNull()
})

test('步骤树：选中合并消息中的步骤时，其他帧为「同一步」并注明「本层合并为 1 步」', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  const next = page.locator('.player button.next')
  for (let i = 0; i < 15 && (await page.locator('.frame.same').count()) === 0; i++) await next.click()
  await expect(page.locator('.frame.selected')).toHaveCount(1)
  await expect(page.locator('.frame.same').first()).toContainText('本层合并为 1 步')
})
