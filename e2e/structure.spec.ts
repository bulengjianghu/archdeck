/** 结构视角（§6.1、§6.3）：首页进入项目、分层总览、下钻与返回、单击选中 */
import { expect, test } from '@playwright/test'
import { graphNode, openDesk, query } from './helpers'

test('首页列出项目，进入 h5player 看到分层总览；双击层下钻，面包屑返回', async ({ page }) => {
  await page.goto('./')
  const card = page.locator('a.card', { hasText: 'H5Player' })
  await expect(card).toBeVisible()
  await card.click()
  await expect(page.locator('.vue-flow__node-band')).toHaveCount(4)

  await graphNode(page, 'infra').locator('.name').dblclick()
  await expect(page.locator('.crumb.current')).toHaveText('Infrastructure')
  expect(query(page).get('level')).toBe('infra')
  await expect(page.locator('.vue-flow__node-band')).toHaveCount(0)

  await page.locator('.crumb', { hasText: 'H5Player' }).click()
  await expect(page.locator('.vue-flow__node-band')).toHaveCount(4)
  // N8：返回上级时选中刚离开的模块
  expect(query(page).get('sel')).toBe('m:infra')
})

test('单击节点选中并在面板显示属性，单击空白取消选中', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra')
  const node = page.locator('.vue-flow__node-module').first()
  const id = await node.getAttribute('data-id')
  // 节点可能落在右下角「显示」面板底下（取决于布局）：直接在节点上派发单击
  await node.dispatchEvent('click')
  expect(query(page).get('sel')).toBe(`m:${id}`)
  await expect(page.locator('.panel h2').first()).toBeVisible()
  await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
  expect(query(page).get('sel')).toBeNull()
})
