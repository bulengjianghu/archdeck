/**
 * 卡片与回放胶囊（第十八轮 Y2、Y3，ADR-0057；走查 4 修订，ADR-0061；验收 6.43）：
 * 第二十二轮波 2：抽屉删除（LY-16），原面板的卡住在视图区的描述 / 核对标签；CD-3 身份卡粘顶（CD-4 名称胶囊已作废）；
 * CD-7 回放胶囊居中、避让缩放胶囊；CD-9 走到 alt 分支时「选路线」。
 */
import { expect, test, type Page } from '@playwright/test'
import { openDesk, showView, waitSettled } from './helpers'

async function rect(page: Page, sel: string) {
  const b = await page.locator(sel).first().boundingBox()
  expect(b, sel).not.toBeNull()
  return b!
}

test('CD-1、CD-2（第二十二轮 LY-13 改写）：抽屉删了（LY-16），原面板的卡住在视图区——描述标签里理解等各卡、核对标签里只有核对卡；面板头只是一行操作（不成卡）', async ({
  page,
}) => {
  await openDesk(page, '/p/media-web-player?sel=m:kit')
  await waitSettled(page)
  await expect(page.locator('aside.props')).toHaveCount(0)
  const looks = async () =>
    (await page.evaluate(`[...document.querySelectorAll('[data-region="views"] .panel [data-card]')].map(el => {
      const s = getComputedStyle(el)
      return { radius: s.borderTopLeftRadius, shadow: s.boxShadow !== 'none' }
    })`)) as { radius: string; shadow: boolean }[]
  await showView(page, 'description')
  await expect(page.locator('[data-region="views"] .panel[data-part="description"] [data-card="understand"]')).toBeVisible()
  // LY-13b：面板头是一行操作——不成卡、没有名称
  const head = (await page.evaluate(
    `(() => { const s = getComputedStyle(document.querySelector('[data-region="views"] .panel[data-part="description"] .id-card')); return { shadow: s.boxShadow, position: s.position } })()`,
  )) as { shadow: string; position: string }
  expect(head).toEqual({ shadow: 'none', position: 'static' })
  const d = await looks()
  expect(d.length).toBeGreaterThanOrEqual(1)
  for (const l of d) expect(l).toMatchObject({ radius: '12px', shadow: true })
  await showView(page, 'check')
  await expect(page.locator('[data-region="views"] .panel[data-part="check"] [data-card="check"]')).toBeVisible()
  // 核对标签只留核对卡：没有面板头
  await expect(page.locator('[data-region="views"] .panel[data-part="check"] .id-card')).toHaveCount(0)
  for (const l of await looks()) expect(l).toMatchObject({ radius: '12px', shadow: true })
})

test('CD-3 作废（第二十二轮 LY-13b）：名称只在主语条；描述顶上一行操作（讨论 ›、进入、在此设计），图解跟随选中', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sel=m:state.desk')
  await waitSettled(page)
  await expect(page.locator('[data-region="views"] .explainer')).toHaveAttribute('data-explainer', 'state.desk')
  await showView(page, 'description')
  const row = page.locator('[data-region="views"] .panel[data-part="description"] .id-card')
  await expect(row.locator('h2')).toHaveCount(0)
  await expect(row.getByRole('button', { name: '讨论 ›' })).toBeVisible()
  await expect(page.locator('[data-head="views"] [data-testid="subject-name"]')).toHaveText('DeskState')
  await expect(page.getByTestId('props-mini')).toHaveCount(0)
})

/** 回放胶囊、缩放胶囊、画布（相对视口） */
async function capsules(page: Page) {
  const [player, zoom, canvas] = await Promise.all([rect(page, '.player-bar'), rect(page, '.zoom-pill'), rect(page, 'main.canvas-area')])
  return { player, zoom, canvas }
}

test('CD-7 回放胶囊：浮在画布底部、与缩放胶囊同一行不相碰（悬浮卡片避让 CD-8 随抽屉删除，LY-16）', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?sc=sc.command')
  await waitSettled(page)
  await expect(page.locator('.player-bar')).toBeVisible()
  const { player, zoom, canvas } = await capsules(page)
  expect(Math.round(canvas.y + canvas.height - (player.y + player.height))).toBe(12)
  expect(Math.round(canvas.y + canvas.height - (zoom.y + zoom.height))).toBe(12)
  expect(player.x).toBeGreaterThanOrEqual(zoom.x + zoom.width + 12 - 0.5)
  // 放得下：胶囊右沿不出画布
  expect(player.x + player.width).toBeLessThanOrEqual(canvas.x + canvas.width)
})

test('CD-7 回放胶囊：视图区收起后居中于更宽的画布', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?sc=sc.command')
  await waitSettled(page)
  await page.locator('[data-head="canvas"] .views-toggle').click()
  await expect(page.locator('.views-area')).toHaveCount(0)
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
