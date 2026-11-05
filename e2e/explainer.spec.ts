/**
 * 图解（ADR-0055，EX-1–EX-7；验收 6.41）：media-web-player 的 kit 与 kit.kernel 两份样例——
 * 预览标签只替换一个、双击固定、分屏上下对照（WS-5、WS-6）；图解里点模块链接在画布上选中它、资料区不动（EX-3、WS-8）；
 * 子模块的 summary 改了，父模块的图解标出「基于旧描述」（EX-6、EX-7，用路由夹具改描述，不改文件）。
 */
import { expect, test, type Page } from '@playwright/test'
import { collapseDisplay, graphNode, openDesk, openPropsDrawer, query, waitSettled } from './helpers'

const dock = (page: Page) => page.getByRole('complementary', { name: '资料区' })
const tabs = (page: Page) => dock(page).locator('.tabs > .tab')

test('验收 6.41 第 1 条：依次单击两份图解只替换一个预览标签；双击固定；分屏后上下对照', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit&sel=m:kit')
  // 图例展开时叠在画布右上，会盖住节点上的 ▣（L48）
  await collapseDisplay(page)
  // 第二十轮：选中即自动打开理解页（事实卡 + 故事），不再经由相关资料卡
  await expect(tabs(page)).toHaveCount(1)
  await expect(tabs(page).first()).toHaveClass(/preview/)
  await expect(tabs(page).first()).toContainText('播放器 Kit')
  await expect(dock(page).frameLocator('iframe').locator('h1')).toContainText('播放器 Kit')

  // 画布上 kit.kernel 的 ▣：单击预览，替换 kit 的预览标签（不改变选中）
  await graphNode(page, 'kit.kernel').locator('[data-testid="explainer-mark"]').click()
  await expect(tabs(page)).toHaveCount(1)
  await expect(tabs(page).first()).toContainText('会话内核')
  expect(query(page).get('sel')).toBe('m:kit')

  // 双击标签固定；分屏后新开的资料进入下组：从画布 ▣ 打开 kit.session，上组 kit.kernel、下组会话规则对照（WS-4：已开的资料只激活，不搬组）
  await tabs(page).first().dblclick()
  await expect(tabs(page).first()).not.toHaveClass(/preview/)
  await dock(page).getByRole('button', { name: /分屏/ }).click()
  await graphNode(page, 'kit.session').locator('[data-testid="explainer-mark"]').click()
  const groups = dock(page).locator('.group')
  await expect(groups).toHaveCount(2)
  await expect(groups.nth(0).locator('.tab.on')).toContainText('会话内核')
  await expect(groups.nth(1).locator('.tab.on')).toContainText('会话规则')
  await expect(groups.nth(0).frameLocator('iframe').locator('h1')).toContainText('会话内核')
  await expect(groups.nth(1).frameLocator('iframe').locator('h1')).toContainText('说明书上的规则页')
  const [top, bottom] = [await groups.nth(0).boundingBox(), await groups.nth(1).boundingBox()]
  expect(bottom!.y).toBeGreaterThan(top!.y + top!.height - 4)
})

test('验收 6.41 第 2 条：图解里点模块链接，画布选中该模块、属性栏随之变化，资料区不动；有图解的引用附「图解 ›」', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?level=kit&sel=m:kit')
  // 选中即自动打开理解页；双击标签固定
  await tabs(page).first().dblclick()
  await expect(tabs(page).first()).not.toHaveClass(/preview/)
  const frame = dock(page).frameLocator('iframe')
  // EX-2：引用由架构台填入描述原文
  await expect(frame.locator('[data-arch="kit.session"][data-field="summary"]')).toHaveText('判定命令能否受理、选出路线、核对事件顺序')
  await expect(frame.locator('a.arch-exp[data-explainer="kit.kernel"]')).toHaveCount(1)
  const before = await tabs(page).allTextContents()

  await frame.locator('.who[data-arch="kit.session"]').click()
  await expect.poll(() => query(page).get('sel')).toBe('m:kit.session')
  // 抽屉可能收起：拉开后看到选中的模块（EX-3：资料区不动）
  await openPropsDrawer(page)
  await expect(page.getByRole('complementary', { name: '属性' })).toContainText('会话规则')
  expect(await tabs(page).allTextContents()).toEqual(before)

  // 「图解 ›」以预览标签打开那份图解
  await frame.locator('a.arch-exp[data-explainer="kit.kernel"]').click()
  await expect(tabs(page)).toHaveCount(2)
  await expect(dock(page).locator('.tab.on')).toContainText('会话内核')
})

test('验收 6.41 第 3 条：临时改 kit.kernel 的 summary，kit 的图解标出「基于旧描述」，相关资料卡与核对卡同样提示', async ({ page }) => {
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
  // 第二十轮：相关资料卡删除，过期提示在辅助栏标签与故事内容区
  await expect(dock(page).locator('[data-testid="tab-stale"]')).toHaveText('基于旧描述 · 1 处改动')
  const stale = dock(page).locator('[data-testid="explainer-stale"]')
  await stale.click()
  await expect(dock(page).locator('.changes')).toContainText('会话内核的一句话职责')
  // 引用的原文已是新的描述
  await expect(dock(page).frameLocator('iframe').locator('[data-arch="kit.kernel"][data-field="summary"]')).toHaveText('串行施用命令并持有唯一状态')
  // kit.kernel 自己的图解同样过期（summary 也是它「本模块」的一项），画布标记变为警示色
  await expect(graphNode(page, 'kit.kernel').locator('[data-testid="explainer-mark"]')).toHaveClass(/stale/)
})

test('走查 4（ADR-0061）：选中带图解的模块资料区自动预览打开、再选另一份替换预览；运行视角不自动，标题后的「图解 ›」手动打开', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=state')
  await waitSettled(page)
  await expect(tabs(page)).toHaveCount(0)
  // 结构视角：选中带图解的模块（state.desk）→ 自动以预览打开；再选另一份带图解的（state.transition）→ 替换预览、不累积
  await graphNode(page, 'state.desk').click()
  await expect(tabs(page)).toHaveCount(1)
  await expect(tabs(page).first()).toHaveClass(/preview/)
  await expect(tabs(page).first()).toContainText('DeskState')
  await graphNode(page, 'state.transition').click()
  await expect(tabs(page)).toHaveCount(1)
  await expect(tabs(page).first()).toContainText('视图状态转移')
  // 运行视角：时序图占用资料区，选中带图解的模块不自动开图解；标题后的「图解 ›」手动打开为预览
  // （hash 内跳转不换文档、工作区留着上一段的图解标签，先到位再整页刷新拿到干净的资料区）
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await page.reload()
  await waitSettled(page)
  await expect(tabs(page)).toHaveCount(1)
  await expect(tabs(page).first()).toContainText('时序图')
  // 场景刚打开选中的是场景本身；先选一个带图解的模块
  await graphNode(page, 'state.desk').click()
  // 运行视角的资料区归时序图与步骤节（01 §6）：不自动、画布 ▣ 也不显示（EX-5），图解在退出场景后随选中打开
  await expect(tabs(page)).toHaveCount(1)
})
