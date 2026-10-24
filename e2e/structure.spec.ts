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

test('L11：关系全是交互，进边的进点都在入口侧的前半（顶边左半 / 左边上半），后半留给端口记号（L13）', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra&sel=m:infra.framework')
  await expect(page.locator('.vue-flow__edge').first()).toBeAttached()
  const result = await page.evaluate(() => {
    const boxes = new Map<string, { x: number; y: number; w: number; h: number }>()
    for (const n of document.querySelectorAll<HTMLElement>('.vue-flow__node-module, .vue-flow__node-core')) {
      const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(n.style.transform)
      if (m) boxes.set(n.dataset.id!, { x: Number(m[1]), y: Number(m[2]), w: n.offsetWidth, h: n.offsetHeight })
    }
    const ends: { to: string; x: number; y: number }[] = []
    for (const e of document.querySelectorAll<SVGGElement>('.vue-flow__edge')) {
      const m = /^(?:core:)?(.+)->(.+):(\w+)$/.exec(e.dataset.id ?? '')
      const d = e.querySelector('path.vue-flow__edge-path')?.getAttribute('d') ?? ''
      const last = /L(-?[\d.]+),(-?[\d.]+)\s*$/.exec(d)
      if (m && last && boxes.has(m[2])) ends.push({ to: m[2], x: Number(last[1]), y: Number(last[2]) })
    }
    return { boxes: [...boxes], ends }
  })
  const boxes = new Map(result.boxes)
  expect(result.ends.length).toBeGreaterThan(0)
  // 线在箭头处回缩、平行边错开半个间距：留 20px 余量
  const bad = result.ends.filter(e => {
    const b = boxes.get(e.to)!
    const top = Math.abs(e.y - b.y) < 30
    return top ? e.x > b.x + b.w / 2 + 20 : e.y > b.y + b.h / 2 + 20
  })
  expect(bad).toEqual([])
})
