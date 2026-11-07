/**
 * 图解（ADR-0055，EX-1–EX-7；ADR-0064，LY-8、LY-9、LY-15）：media-web-player 的 kit 与 kit.kernel 两份样例——
 * 图解是常驻的视图标签、跟随主语：画布 ▣、图解里的模块链接与「图解 ›」都是选中，视图随之换内容、标签不增不减；
 * 子模块的 summary 改了，父模块的图解标出「基于旧描述」（EX-6、EX-7，用路由夹具改描述，不改文件）。
 */
import { expect, test, type Page } from '@playwright/test'
import { activeTab, collapseDisplay, graphNode, openDesk, query, showView, viewTab, views, waitSettled } from './helpers'

const tabs = (page: Page) => views(page).locator('.tabs > .tab')
const story = (page: Page) => views(page).frameLocator('iframe')

test('验收 6.41 第 1 条（LY-15 改写）：图解标签常驻、跟随主语——单击画布 ▣ 即选中该模块，图解换成它的，标签不增不减', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit&sel=m:kit')
  // 图例展开时叠在画布右上，会盖住节点上的 ▣（L48）
  await collapseDisplay(page)
  await expect(tabs(page)).toHaveCount(3)
  await expect(activeTab(page)).toHaveAttribute('data-view-tab', 'explainer')
  await expect(viewTab(page, 'explainer').locator('.x')).toHaveCount(0)
  await expect(story(page).locator('h1')).toContainText('播放器 Kit')

  await graphNode(page, 'kit.kernel').locator('[data-testid="explainer-mark"]').click()
  await expect.poll(() => query(page).get('sel')).toBe('m:kit.kernel')
  await expect(story(page).locator('h1')).toContainText('会话内核')
  await expect(tabs(page)).toHaveCount(3)

  // 换到描述再点 ▣：图解标签被激活
  await showView(page, 'description')
  await graphNode(page, 'kit.session').locator('[data-testid="explainer-mark"]').click()
  await expect(activeTab(page)).toHaveAttribute('data-view-tab', 'explainer')
  await expect(story(page).locator('h1')).toContainText('说明书上的规则页')
})

test('验收 6.41 第 2 条（LY-15 改写）：图解里点模块链接即选中该模块，图解随主语跟随；「图解 ›」同样是选中', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit&sel=m:kit')
  const frame = story(page)
  // EX-2：引用由架构台填入描述原文
  await expect(frame.locator('[data-arch="kit.session"][data-field="summary"]')).toHaveText('判定命令能否受理、选出路线、核对事件顺序')
  await expect(frame.locator('a.arch-exp[data-explainer="kit.kernel"]')).toHaveCount(1)
  const before = await tabs(page).allTextContents()

  await frame.locator('.who[data-arch="kit.session"]').click()
  await expect.poll(() => query(page).get('sel')).toBe('m:kit.session')
  await expect(story(page).locator('h1')).toContainText('说明书上的规则页')
  expect(await tabs(page).allTextContents()).toEqual(before)

  // 回到 kit 再点「图解 ›」：选中 kit.kernel、图解换成它的
  await page.goto('./#/p/media-web-player?level=kit&sel=m:kit')
  await page.reload()
  await expect(story(page).locator('h1')).toContainText('播放器 Kit')
  await expect(story(page).locator('a.arch-exp[data-explainer="kit.kernel"]')).toHaveCount(1)
  await story(page).locator('a.arch-exp[data-explainer="kit.kernel"]').click()
  await expect.poll(() => query(page).get('sel')).toBe('m:kit.kernel')
  await expect(story(page).locator('h1')).toContainText('会话内核')
  expect(await tabs(page).allTextContents()).toEqual(before)
})

test('验收 6.41 第 3 条：临时改 kit.kernel 的 summary，kit 的图解标出「基于旧描述」', async ({ page }) => {
  await page.route('**/models/media-web-player.json', async route => {
    const res = await route.fetch()
    const body = (await res.json()) as { files: { path: string; text: string }[] }
    const files = body.files.map(f =>
      f.path === 'modules/kit.yaml'
        ? { ...f, text: f.text.replace('summary: 按序施用命令，维护唯一的会话状态并干净释放', 'summary: 串行施用命令并持有唯一状态') }
        : f,
    )
    await route.fulfill({ response: res, json: { ...body, files } })
  })
  await openDesk(page, '/p/media-web-player?level=kit&sel=m:kit')
  const stale = views(page).locator('[data-testid="explainer-stale"]')
  await expect(stale).toContainText('基于旧描述 · 1 处改动')
  await stale.click()
  await expect(views(page).locator('.changes')).toContainText('会话内核的一句话职责')
  // 引用的原文已是新的描述
  await expect(story(page).locator('[data-arch="kit.kernel"][data-field="summary"]')).toHaveText('串行施用命令并持有唯一状态')
  // kit.kernel 自己的图解同样过期（summary 也是它「本模块」的一项），画布标记变为警示色
  await expect(graphNode(page, 'kit.kernel').locator('[data-testid="explainer-mark"]')).toHaveClass(/stale/)
})

test('LY-16：选中不自动开标签——视图区排布不变，图解随选中换内容；回放中按场景排布，画布 ▣ 不显示', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=state')
  await waitSettled(page)
  const before = await tabs(page).allTextContents()
  expect(before).toHaveLength(3)
  await graphNode(page, 'state.desk').click()
  await expect(story(page).locator('h1').first()).toBeVisible()
  await expect(views(page).locator('.module-doc')).toHaveAttribute('data-module', 'state.desk')
  await graphNode(page, 'state.transition').click()
  await expect(views(page).locator('.module-doc')).toHaveAttribute('data-module', 'state.transition')
  expect(await tabs(page).allTextContents()).toEqual(before)

  // 回放：场景排布——上〔时序图 图解 核对〕下〔描述〕
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await page.reload()
  await waitSettled(page)
  await expect(activeTab(page, 0)).toHaveAttribute('data-view-tab', 'sequence')
  await expect(activeTab(page, 1)).toHaveAttribute('data-view-tab', 'description')
  await expect(viewTab(page, 'sequence').locator('.x')).toHaveCount(0)
  await expect(page.locator('[data-testid="explainer-mark"]')).toHaveCount(0)
})
