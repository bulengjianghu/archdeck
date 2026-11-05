/**
 * 卡片与回放胶囊（第十八轮 Y2、Y3，ADR-0057；走查 4 修订，ADR-0061；验收 6.43）：
 * CD-2 并排时属性列与画布同底色、没有分隔线；悬浮时卡片之间的空隙落到画布；CD-3 身份卡粘顶（CD-4 名称胶囊已作废）；
 * CD-7、CD-8 回放胶囊居中、避让缩放胶囊与悬浮卡片；CD-9 走到 alt 分支时「选路线」。
 */
import { expect, test, type Page } from '@playwright/test'
import { openDesk, query, waitSettled } from './helpers'

async function rect(page: Page, sel: string) {
  const b = await page.locator(sel).first().boundingBox()
  expect(b, sel).not.toBeNull()
  return b!
}

test('CD-2（第二十轮 §4 改写）：选中面板是实底抽屉——不透画布、与画布有分界；抽屉里的卡各自是卡', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?sel=m:kit')
  await waitSettled(page)
  await page.getByRole('button', { name: '属性', exact: true }).click() // 抽屉缺省收起
  await page.locator('.dock-toggle').click()
  await expect(page.locator('.dock-area')).toHaveCount(0)
  const props = page.locator('aside.props')
  await expect(props).not.toHaveClass(/floating/)
  const own = (await page.evaluate(`(() => {
    const el = document.querySelector('aside.props')
    const s = getComputedStyle(el)
    return { border: s.borderLeftWidth, bg: s.backgroundColor, shadow: s.boxShadow !== 'none' }
  })()`)) as { border: string; bg: string; shadow: boolean }
  // 实底抽屉：不透画布、有分界线
  expect(own.bg).not.toBe('rgba(0, 0, 0, 0)')
  expect(own.border).toBe('1px')
  // 核对卡仍是卡：圆角与投影
  const look = (await page.evaluate(`[...document.querySelectorAll('.panel .id-card, .panel [data-card]')].map(el => {
    const s = getComputedStyle(el)
    return { radius: s.borderTopLeftRadius, shadow: s.boxShadow !== 'none' }
  })`)) as { radius: string; shadow: boolean }[]
  expect(look.length).toBeGreaterThanOrEqual(2)
  for (const l of look) expect(l).toMatchObject({ radius: '12px', shadow: true })
})

test('CD-2 悬浮（第二十轮 §4 改写）：放不下时浮在画布右侧——实底、不透传点击；画布其余部分照常接指针', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 })
  await openDesk(page, '/p/media-web-player?sel=m:kit')
  await waitSettled(page)
  await page.getByRole('button', { name: '属性', exact: true }).click() // 抽屉缺省收起，先拉开
  await expect(page.locator('aside.props')).toHaveClass(/floating/)
  const pr = await rect(page, 'aside.props')
  // 抽屉上任意一点都归抽屉（实底、不透传）
  const inside = await page.evaluate(`!!document.elementFromPoint(${pr.x + pr.width / 2}, ${pr.y + pr.height / 2})?.closest('aside.props')`)
  expect(inside).toBe(true)
  // 画布左半边照常接指针：单击空白取消选中
  const canvas = await rect(page, 'main.canvas-area')
  const cx = canvas.x + 60
  const cy = canvas.y + canvas.height / 2
  const hit = (await page.evaluate(`(() => {
    const el = document.elementFromPoint(${cx}, ${cy})
    const node = el?.closest('.vue-flow__node')
    return { vueflow: !!el?.closest('.vue-flow'), node: node?.getAttribute('data-id') ?? null, band: !!node?.querySelector('.frame, .tier') || (node?.classList.contains('vue-flow__node-frame') ?? false) }
  })()`)) as { vueflow: boolean; node: string | null; band: boolean }
  expect(hit.vueflow).toBe(true)
  await page.mouse.click(cx, cy)
  // 带框 / 分层节点点击穿透（等于点画布空白=取消选中）；普通模块节点则选中它
  await expect.poll(() => query(page).get('sel')).toBe(hit.band || !hit.node ? null : `m:${hit.node}`)
})

test('CD-3 身份卡粘顶（ADR-0061）：滚到底身份卡仍钉在抽屉上沿；选中即自动打开辅助栏的理解页', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sel=m:state.desk')
  await waitSettled(page)
  await page.getByRole('button', { name: '属性', exact: true }).click() // 抽屉缺省收起，拉开量粘顶
  const area = page.locator('.panel-area')
  const card = page.locator('.panel .id-card').first()
  // 选中（含 URL 直达）即自动在辅助栏打开理解页（事实卡 + 故事，第二十轮读先方案）
  await expect(page.locator('.dock-area .tab[data-doc="exp:state.desk"]')).toHaveClass(/preview/)
  // 滚到底：身份卡钉在滚动区上沿，没有名称胶囊
  await area.evaluate(el => el.scrollTo({ top: el.scrollHeight }))
  const [cardBox, areaBox] = await Promise.all([card.boundingBox(), area.boundingBox()])
  expect(cardBox!.y).toBeGreaterThanOrEqual(areaBox!.y - 0.5)
  expect(cardBox!.y - areaBox!.y).toBeLessThan(12) // 面板内边距之内钉住
  await expect(page.getByTestId('props-mini')).toHaveCount(0)
  await expect(page.locator('.dock-area .tab[data-doc="exp:state.desk"]')).toHaveCount(1)
})

/** 回放胶囊、缩放胶囊、画布（相对视口） */
async function capsules(page: Page) {
  const [player, zoom, canvas] = await Promise.all([rect(page, '.player-bar'), rect(page, '.zoom-pill'), rect(page, 'main.canvas-area')])
  const inset = (await page.evaluate(
    `parseFloat(getComputedStyle(document.querySelector('main.canvas-area')).getPropertyValue('--canvas-inset')) || 0`,
  )) as number
  return { player, zoom, canvas, inset }
}

test('CD-7、CD-8 回放胶囊（第二十轮 §4 改写）：浮在画布底部、与缩放胶囊同一行不相碰；运行视角抽屉自动收起，胶囊居中于整个画布', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?sc=sc.command')
  await waitSettled(page)
  await expect(page.locator('.player-bar')).toBeVisible()
  // 运行视角：选中抽屉自动收起（步骤节在辅助栏），不再有悬浮卡片让位
  await expect(page.locator('aside.props')).toHaveCount(0)
  const { player, zoom, canvas } = await capsules(page)
  expect(Math.round(canvas.y + canvas.height - (player.y + player.height))).toBe(12)
  expect(Math.round(canvas.y + canvas.height - (zoom.y + zoom.height))).toBe(12)
  expect(player.x).toBeGreaterThanOrEqual(zoom.x + zoom.width + 12 - 0.5)
  // 放得下：胶囊右沿不出画布
  expect(player.x + player.width).toBeLessThanOrEqual(canvas.x + canvas.width)
})

test('CD-8 回放胶囊：资料区隐藏后居中于更宽的画布', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?sc=sc.command')
  await waitSettled(page)
  await page.locator('.dock-toggle').click()
  await expect(page.locator('.dock-area')).toHaveCount(0)
  await expect
    .poll(async () => {
      const { player, canvas } = await capsules(page)
      return Math.round(player.x + player.width / 2 - (canvas.x + canvas.width / 2))
    })
    .toBe(0)
})

test('CD-9 走到 alt 未选的分支：胶囊上是警示色的「选路线 ▾」，浮层自动展开分支选择；选一支后回到编号', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?sc=sc.command')
  await waitSettled(page)
  const btn = page.getByTestId('route-btn')
  const next = page.locator('.player button.next')
  for (let i = 0; i < 15 && !((await btn.count()) && (await btn.innerText()).startsWith('选路线')); i++) await next.click()
  await expect(btn).toHaveText('选路线 ▾')
  await expect(btn).toHaveClass(/need/)
  const pop = page.getByTestId('route-pop')
  await expect(pop).toBeVisible()
  await expect(pop.locator('.branches .opt').first()).toBeVisible()
  await pop.locator('.branches .opt').nth(1).click()
  await expect(btn).not.toHaveText('选路线 ▾')
  await expect(btn).toHaveText(/^路线 2/)
})
