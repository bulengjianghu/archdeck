/**
 * 机制标签（ADR-0041，01 §6.28）：交互的机制写在标签位（L35），标签位至多两段——异常段（警示色）在前、修饰段（中性）在后，
 * 标签至多两个、其余「+k」并在悬停列出（L26②）；经端口的线插座与「端口」并存（L12）；分层总览照写（L26③）；「混合」只表同步 / 异步（L23）。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { collapseDisplay, openDesk } from './helpers'

const pills = (page: Page) => page.locator('.vue-flow__edge-route .edge-pill')
const textOf = async (l: Locator) => ((await l.locator('.vue-flow__edge-text').textContent()) ?? '').replace(/\s+/g, ' ').trim()

test('§6.28-1：media-web-player「播放器 Kit」——经端口、总线、平台事件、回调的线带中性标签，经端口的线入口有插座', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit')
  await collapseDisplay(page)
  const texts = await Promise.all((await pills(page).all()).map(textOf))
  const all = texts.join(' | ')
  for (const tag of ['端口', '总线', '事件', '回调']) expect(all).toContain(tag)
  // 机制是修饰：写在中性段（plain）
  await expect(page.locator('.edge-pill .pill-text.plain', { hasText: '端口' }).first()).toBeAttached()
  // L12：带「端口」标签的边同时画插座
  const port = page.locator('.vue-flow__edge-route').filter({ has: page.locator('.pill-text', { hasText: '端口' }) })
  await expect(port.first().locator('.edge-socket')).toBeAttached()
})

test('§6.28-2：media-web-player 根层分层总览——层间边照写机制标签', async ({ page }) => {
  await openDesk(page, '/p/media-web-player')
  await collapseDisplay(page)
  const all = (await Promise.all((await pills(page).all()).map(textOf))).join(' | ')
  expect(all).toMatch(/端口|总线|注入|回调/)
})

test('§6.28-3：h5player「Application」代码事实开（缺省）——异常（未证实）在警示段、机制在其后的中性段', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=app')
  await collapseDisplay(page)
  // 两段：同一个 pill 里先 warn 段、后 plain 段（如「×5 · 2 把手 · 未证实 4」「端口 1」）
  const two = pills(page)
    .filter({ has: page.locator('rect.warn') })
    .filter({ has: page.locator('rect.plain') })
  await expect(two.first()).toBeAttached()
  const kinds = await two
    .first()
    .locator('rect')
    .evaluateAll(rs => rs.map(r => r.getAttribute('class')))
  expect(kinds.map(k => (k?.includes('warn') ? 'warn' : 'plain'))).toEqual(['warn', 'plain'])
  await expect(two.first().locator('.pill-text.warn')).toHaveText(/未证实/)
})

test('§6.28-3：标签超过两个写「+k」接在最后一段末尾，悬停逐条列出（h5player 根层：向上、注入、混合）', async ({ page }) => {
  await openDesk(page, '/p/h5player')
  await collapseDisplay(page)
  const more = page.locator('.vue-flow__edge-route').filter({ has: page.locator('.pill-text', { hasText: /\+\d/ }) })
  await expect(more.first()).toBeAttached()
  await expect(more.first().locator('.pill-text').last()).toHaveText(/\+\d+$/)
  await expect(more.first().locator('title').first()).toHaveText(/另 \d+ 个标签/)
  // 「向上」是异常：在警示段
  await expect(page.locator('.pill-text.warn', { hasText: '向上' }).first()).toBeAttached()
})

test('§6.28-4：「混合」只出现在同步 / 异步不一致的束上', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=app')
  for (const t of await page.locator('.vue-flow__edge-route g[data-mixed] > title').allTextContents()) expect(t).toContain('同步 / 异步不一致')
})

test('L26（ADR-0041）、ADR-0058：机制词写在线上、不进图例；悬停线上的标签附机制释义（L50）', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit')
  // ADR-0058 准入第一问：机制词与两段标签位是画布 pill 自己会说的字，图例不再列「标签」「两段」两行
  const legend = page.getByRole('region', { name: '图例' })
  await expect(legend.getByTestId('legend-mechanisms')).toHaveCount(0)
  await expect(legend.getByTestId('legend-pill')).toHaveCount(0)
  // kit 层有总线 / 端口机制的边：词在标签位，悬停提示末尾附「图例 · 总线：…」或「图例 · 端口：…」
  const tips = await page.locator('.vue-flow__edges g > title').allTextContents()
  expect(tips.some(t => /图例 · (总线|端口)：/.test(t))).toBe(true)
})
