/**
 * 卡片与回放胶囊（第十八轮 Y2、Y3，ADR-0057；验收 6.43）：
 * CD-2 并排时属性列与画布同底色、没有分隔线；悬浮时卡片之间的空隙落到画布；CD-4 名称胶囊；
 * CD-7、CD-8 回放胶囊居中、避让缩放胶囊与悬浮卡片；CD-9 走到 alt 分支时「选路线」。
 */
import { expect, test, type Page } from '@playwright/test'
import { openDesk, query, waitSettled } from './helpers'

/** 元素的实际底色：自己透明时取最近的不透明祖先 */
const EFFECTIVE_BG = `(sel) => {
  let el = document.querySelector(sel)
  while (el) {
    const bg = getComputedStyle(el).backgroundColor
    if (bg && bg !== 'transparent' && !/rgba\\(.*,\\s*0\\)$/.test(bg)) return bg
    el = el.parentElement
  }
  return getComputedStyle(document.body).backgroundColor
}`

async function rect(page: Page, sel: string) {
  const b = await page.locator(sel).first().boundingBox()
  expect(b, sel).not.toBeNull()
  return b!
}

test('CD-2 并排：属性列与画布同底色，没有竖分隔线与底板；卡片各自是卡', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?sel=m:kit')
  await waitSettled(page)
  const props = page.locator('aside.props')
  await expect(props).not.toHaveClass(/floating/)
  const [propsBg, canvasBg] = await Promise.all([page.evaluate(`(${EFFECTIVE_BG})('aside.props')`), page.evaluate(`(${EFFECTIVE_BG})('main.canvas-area')`)])
  expect(propsBg).toBe(canvasBg)
  const own = (await page.evaluate(`(() => {
    const el = document.querySelector('aside.props')
    const s = getComputedStyle(el)
    return { border: s.borderLeftWidth, bg: s.backgroundColor, panelBg: getComputedStyle(el.querySelector('.panel')).backgroundColor }
  })()`)) as { border: string; bg: string; panelBg: string }
  expect(own.border).toBe('0px')
  expect(own.bg).toBe('rgba(0, 0, 0, 0)')
  expect(own.panelBg).toBe('rgba(0, 0, 0, 0)')
  // 身份卡与三卡都有卡片的圆角与投影，彼此间距 12
  const look = (await page.evaluate(`[...document.querySelectorAll('.panel .id-card, .panel [data-card]')].map(el => {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return { radius: s.borderTopLeftRadius, shadow: s.boxShadow !== 'none', top: r.top, bottom: r.bottom }
  })`)) as { radius: string; shadow: boolean; top: number; bottom: number }[]
  expect(look.length).toBeGreaterThanOrEqual(3)
  for (const l of look) expect(l).toMatchObject({ radius: '12px', shadow: true })
  expect(Math.round(look[1].top - look[0].bottom)).toBe(12)
})

test('CD-2 悬浮：没有整列的浮板，单击卡片之间的空隙落到画布上', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 })
  await openDesk(page, '/p/media-web-player?sel=m:kit')
  await waitSettled(page)
  await expect(page.locator('aside.props')).toHaveClass(/floating/)
  const id = await rect(page, '.panel .id-card')
  const und = await rect(page, '.panel [data-card="understand"]')
  const x = id.x + id.width / 2
  const y = (id.y + id.height + und.y) / 2
  expect(und.y - (id.y + id.height)).toBeGreaterThan(8)
  const hit = (await page.evaluate(`(() => {
    const el = document.elementFromPoint(${x}, ${y})
    return { canvas: !!el?.closest('.vue-flow'), props: !!el?.closest('aside.props'), node: el?.closest('.vue-flow__node')?.getAttribute('data-id') ?? null }
  })()`)) as { canvas: boolean; props: boolean; node: string | null }
  expect(hit).toMatchObject({ canvas: true, props: false })
  // 卡片上照常接指针
  const onCard = await page.evaluate(`!!document.elementFromPoint(${x}, ${und.y + 20})?.closest('aside.props')`)
  expect(onCard).toBe(true)
  await page.mouse.click(x, y)
  await expect.poll(() => query(page).get('sel')).toBe(hit.node ? `m:${hit.node}` : null)
})

test('CD-4 名称胶囊：身份卡滚走后出现，回到顶部消失；单击胶囊滚回顶部', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit&sel=m:kit.kernel')
  await waitSettled(page)
  const mini = page.getByTestId('props-mini')
  await expect(mini).toHaveCount(0)
  await page.locator('.panel-area').evaluate(el => el.scrollTo({ top: 400 }))
  await expect(mini).toBeVisible()
  await expect(mini).toHaveText('会话内核')
  await mini.click()
  await expect.poll(() => page.locator('.panel-area').evaluate(el => el.scrollTop)).toBe(0)
  await expect(mini).toHaveCount(0)
})

/** 回放胶囊、缩放胶囊、画布（相对视口） */
async function capsules(page: Page) {
  const [player, zoom, canvas] = await Promise.all([rect(page, '.player-bar'), rect(page, '.zoom-pill'), rect(page, 'main.canvas-area')])
  const inset = (await page.evaluate(
    `parseFloat(getComputedStyle(document.querySelector('main.canvas-area')).getPropertyValue('--canvas-inset')) || 0`,
  )) as number
  return { player, zoom, canvas, inset }
}

test('CD-7、CD-8 回放胶囊：浮在画布底部、与缩放胶囊同一行不相碰；放不下时居中于整个画布、悬浮卡片让出底部', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?sc=sc.command')
  await waitSettled(page)
  await expect(page.locator('.player-bar')).toBeVisible()
  await expect(page.locator('aside.props')).toHaveClass(/floating/)
  const { player, zoom, canvas, inset } = await capsules(page)
  // 同一行：底边都离画布底 12
  expect(Math.round(canvas.y + canvas.height - (player.y + player.height))).toBe(12)
  expect(Math.round(canvas.y + canvas.height - (zoom.y + zoom.height))).toBe(12)
  expect(player.x).toBeGreaterThanOrEqual(zoom.x + zoom.width + 12 - 0.5)
  const free = canvas.width - inset
  const fits = player.x - canvas.x + player.width <= free - 12
  if (fits) expect(player.x + player.width).toBeLessThanOrEqual(canvas.x + free)
  else {
    // 放不下：悬浮卡片列的底部让出胶囊
    const props = await rect(page, 'aside.props')
    expect(props.y + props.height).toBeLessThanOrEqual(player.y - 12 + 0.5)
    expect(await page.locator('.player-bar').getAttribute('class')).toContain('wide')
  }
})

test('CD-8 回放胶囊：资料区隐藏、属性并排时居中于画布', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?sc=sc.command')
  await waitSettled(page)
  await page.locator('.dock-toggle').click()
  await expect(page.locator('.dock-area')).toHaveCount(0)
  await expect(page.locator('aside.props')).not.toHaveClass(/floating/)
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
