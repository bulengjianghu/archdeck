/** 交互视角（§6.1、§6.3，ADR-0031 之前称结构视角）：首页进入项目、分层总览、下钻与返回、单击选中 */
import { expect, test } from '@playwright/test'
import { graphNode, openDesk, openPropsDrawer, query } from './helpers'

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

  await page.locator('.crumb', { hasText: '根层' }).click()
  await expect(page.locator('.vue-flow__node-band')).toHaveCount(4)
  // N8：返回上级时选中刚离开的模块
  expect(query(page).get('sel')).toBe('m:infra')
})

test('单击节点选中并在面板显示属性，单击空白取消选中', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra')
  await openPropsDrawer(page) // 抽屉缺省收起（第二十轮 §4）
  const node = page.locator('.vue-flow__node-module').first()
  const id = await node.getAttribute('data-id')
  // 节点可能落在右上角的图例底下（取决于布局）：直接在节点上派发单击
  await node.dispatchEvent('click')
  expect(query(page).get('sel')).toBe(`m:${id}`)
  // LY-13b：名称只在主语条；描述顶上是一行操作
  await expect(page.locator('.panel .id-card').first()).toBeVisible()
  await expect(page.locator('[data-testid="subject-name"]')).not.toHaveText('')
  await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
  expect(query(page).get('sel')).toBeNull()
})

test('L11：关系全是交互，进边的进点都在入口侧的前半（顶边左半 / 左边上半），后半留给端口记号（L13）', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra&sel=m:infra.framework')
  await expect(page.locator('.vue-flow__edge').first()).toBeAttached()
  const nodes = await page
    .locator('.vue-flow__node-module, .vue-flow__node-core')
    // C6、L23：展开表面的节点（这里选中的模块）入边一侧整条排端口点，接到点的边不按前半 / 后半，不在本条检查之内
    .evaluateAll(els =>
      els
        .filter(n => !n.querySelector('[data-testid="surface-marks"]'))
        .map(n => ({ id: n.getAttribute('data-id') ?? '', style: n.getAttribute('style') ?? '' })),
    )
  const boxMap = new Map<string, { x: number; y: number; w: number; h: number }>()
  for (const n of nodes) {
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(n.style)
    const w = /width: ([\d.]+)px/.exec(n.style)
    const h = /height: ([\d.]+)px/.exec(n.style)
    if (m && w && h) boxMap.set(n.id, { x: Number(m[1]), y: Number(m[2]), w: Number(w[1]), h: Number(h[1]) })
  }
  const edgeAttrs = await page
    .locator('.vue-flow__edge')
    .evaluateAll(els => els.map(e => ({ id: e.getAttribute('data-id') ?? '', d: e.querySelector('path.vue-flow__edge-path')?.getAttribute('d') ?? '' })))
  const ends: { to: string; x: number; y: number }[] = []
  for (const e of edgeAttrs) {
    const m = /^(?:core:)?(.+)->(.+):(\w+)$/.exec(e.id)
    const last = /L(-?[\d.]+),(-?[\d.]+)\s*$/.exec(e.d)
    if (m && last && boxMap.has(m[2])) ends.push({ to: m[2], x: Number(last[1]), y: Number(last[2]) })
  }
  const result = { boxes: [...boxMap], ends }
  const boxes = new Map(result.boxes)
  expect(result.ends.length).toBeGreaterThan(0)
  // 线在箭头处回缩、平行边错开半个间距：留 20px 余量
  // 进点在盒子正上方为顶边进、看左右（左半）；在盒子两侧为侧边进（框线左侧的 adapter 从右边进，L14）、看上下（上半）
  const bad = result.ends.filter(e => {
    const b = boxes.get(e.to)!
    const top = e.x >= b.x && e.x <= b.x + b.w
    return top ? e.x > b.x + b.w / 2 + 20 : e.y > b.y + b.h / 2 + 20
  })
  expect(bad.map(e => ({ ...e, box: boxes.get(e.to) }))).toEqual([])
})
