/**
 * 图例与「显示 ▾」（第十七轮 R4，ADR-0056；L45、L47–L51、W-2）：有记号的开关就是图例行（单击切换、关着淡色常列），
 * 没有记号的设置在工具栏「显示 ▾」，两处不重复；隐藏画布内容的开关在画布角留痕计数、单击撤销；图例在画布右上角，
 * 第一次进入展开、之后按本机记住；三问四修饰在帮助，图例关系组「?」过去；悬停线时提示末尾附图例释义；时序图图例在时序图标签
 */
import { expect, test } from '@playwright/test'
import { openDesk } from './helpers'

const legendOf = (page: import('@playwright/test').Page) => page.getByRole('region', { name: '图例' })
const menuBtn = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^显示 ▾/ })

test('交互视角：类型行即开关——单击隐藏一类、行变淡仍列着，画布角留痕、单击恢复；摘要在「显示 ▾」旁（L45、L47、L49）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const legend = legendOf(page)
  // L48：画布右上角，第一次进入展开
  await expect(legend.locator('.head-btn')).toHaveAttribute('aria-expanded', 'true')
  const box = (await legend.boundingBox())!
  const canvas = (await page.locator('.canvas-area').boundingBox())!
  expect(box.y - canvas.y).toBeLessThan(40)
  expect(canvas.x + canvas.width - (box.x + box.width)).toBeLessThan(400)
  // L51：三问不在图例里；ADR-0058：机制词是写在线上的字、不列，粗细行照列只解码；各节不折叠
  await expect(legend.getByRole('list', { name: '三问定类型' })).toHaveCount(0)
  await expect(legend).not.toContainText('读完类型再读')
  await expect(legend.getByTestId('legend-mechanisms')).toHaveCount(0)
  await expect(legend.getByTestId('legend-width')).toContainText('≥5')
  await expect(legend.locator('.group-btn')).toHaveCount(0)
  // L45：类型行就是开关
  // L47：只列本层画面出现的类型——h5p 根层有委托
  const calls = legend.getByRole('switch', { name: '委托' })
  await expect(calls).toHaveAttribute('aria-checked', 'true')
  await calls.click()
  await expect(calls).toHaveAttribute('aria-checked', 'false')
  await expect(calls).toBeVisible()
  const corner = page.getByTestId('filter-corner')
  await expect(corner).toHaveText('隐藏 1 类关系')
  // 留痕在图例之下、同一列（L48）
  expect((await corner.boundingBox())!.y).toBeGreaterThan(box.y)
  await corner.click()
  await expect(calls).toHaveAttribute('aria-checked', 'true')
  await expect(corner).toHaveCount(0)
  // L49：「显示 ▾」里没有图例上的开关；边界节点在菜单里；摘要列出非默认设置
  await calls.click()
  await menuBtn(page).click()
  const menu = page.getByRole('menu', { name: '显示' })
  await expect(menu.getByRole('switch')).toHaveCount(0)
  await expect(menu.getByText('委托')).toHaveCount(0)
  await menu.getByLabel('边界节点').uncheck()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(page.getByTestId('display-summary')).toHaveAttribute('data-summary', '隐藏 1 类关系 · 无边界节点')
})

test('回放：交互关系显示方式在「显示 ▾」里，结构类开关不出现；关系类型行只读（L9、L49）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await expect(page.getByTestId('display-summary')).toHaveCount(0)
  await menuBtn(page).click()
  const menu = page.getByRole('menu', { name: '显示' })
  await expect(menu.getByLabel('边界节点')).toHaveCount(0)
  await expect(menu).toContainText('场景中显示全部节点与关系类型')
  await menu.getByRole('button', { name: '淡显' }).click()
  await expect(menu.getByRole('button', { name: '淡显' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('display-summary')).toHaveAttribute('data-summary', '交互关系：淡显')
  // 回放的图例：类型行不是开关；回放的记号都是临时记号，在缺省折叠的脚注里（ADR-0058）
  const legend = legendOf(page)
  await expect(legend.locator('[data-type]').first()).toBeVisible()
  await expect(legend.getByRole('switch')).toHaveCount(0)
  await expect(legend).not.toContainText('当前步骤（沿消息方向流动）')
  await expect(legend.getByTestId('legend-temp')).toContainText(/回放 \/ 选中时另有 \d+ 种记号/)
  await legend.getByTestId('legend-temp').click()
  await expect(legend).toContainText('当前步骤（沿消息方向流动）')
})

test('结构视角（L19、L21、L45、L49）：「只引类型」档行即开关、带收起条数；只看交互使用 / 只看未解释 / 总是展开表面在「显示 ▾」', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?v=s')
  const legend = legendOf(page)
  // ADR-0058：按视觉通道分节（线 / 节点 / 指标 / 叠加 / 临时可见），不再有可折叠的组
  await expect(legend.locator('.body > [aria-label="线"]')).toBeVisible()
  await expect(legend.locator('.body > [aria-label="指标"]')).toBeVisible()
  await expect(legend.locator('.group-btn')).toHaveCount(0)
  for (const t of ['= 空心三角，在基类一端', '= 实心菱形，在组装者一端', '= 空心菱形 ◇', '= 开口箭头，指向被依赖方']) await expect(legend).toContainText(t)
  // 束的概念在帮助；表面元素四类、+N、表面 W 是展开表面才出现的记号——在脚注
  await expect(legend).not.toContainText('一对模块之间画一条束')
  await expect(legend.getByLabel('表面元素四类')).toHaveCount(0)
  await legend.getByTestId('legend-temp').click()
  await expect(legend.getByLabel('表面元素四类')).toContainText('端口')
  await expect(legend).toContainText('表面 W')
  await expect(legend).not.toContainText('越过入口')
  await legend.getByTestId('legend-temp').click()
  await expect(legend.getByRole('switch', { name: '代码事实' })).toHaveCount(0)
  // 只引类型：缺省关、淡色常列（L47），带本层收起条数
  await expect(legend.getByRole('switch', { name: '只引类型' })).toHaveAttribute('aria-checked', 'false')
  // 「显示 ▾」：三项带计数
  await menuBtn(page).click()
  const menu = page.getByRole('menu', { name: '显示' })
  const value = menu.getByTestId('value-count')
  await expect(value).toContainText(/打开后收起值使用的束 \d+ 条/)
  const v = (await value.textContent())!.match(/值使用的束 (\d+) 条/)![1]
  await menu.getByRole('switch', { name: '只看交互使用' }).check()
  await expect(value).toContainText(`值使用的束 ${v} 条已收起`)
  const unc = menu.getByTestId('uncovered-count')
  await expect(unc).toContainText(/打开后收起已解释的束 \d+ 条/)
  await menu.getByRole('switch', { name: '只看未解释' }).check()
  await expect(unc).toContainText(/已解释的束 \d+ 条已收起/)
  await menu.getByRole('switch', { name: '总是展开表面' }).check()
  await expect(page.getByTestId('display-summary')).toHaveAttribute('data-summary', '只看交互使用 · 只看未解释 · 总是展开表面')
  for (const name of ['只看交互使用', '只看未解释', '总是展开表面']) await menu.getByRole('switch', { name }).uncheck()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('display-summary')).toHaveCount(0)

  // h5player 领域层有只引类型的束：单击档行画出，条数不变，再单击收起；画布角留痕随之消失 / 出现（L15、L45）
  await openDesk(page, '/p/h5player?level=domain&v=s')
  const typeRow = legendOf(page).getByRole('switch', { name: '只引类型' })
  await expect(typeRow).toHaveAttribute('aria-checked', 'false')
  await expect(typeRow).toContainText(/· \d+ 条已收起/)
  const n = (await typeRow.textContent())!.match(/(\d+) 条已收起/)![1]
  expect(Number(n)).toBeGreaterThan(0)
  await expect(page.getByTestId('type-only-corner')).toBeVisible()
  await typeRow.click()
  await expect(typeRow).toContainText(`· ${n} 条已显示`)
  await expect(page.getByTestId('type-only-corner')).toHaveCount(0)
  await expect(page.getByTestId('display-summary')).toHaveAttribute('data-summary', '只引类型已显示')
  await typeRow.click()
  await expect(typeRow).toContainText(`· ${n} 条已收起`)
})

test('交互视角「叠加」一节的代码事实：开关行后只列非文字记号，关闭后只剩开关行、画布角留痕写明口径、单击恢复（L22、L26、L45，ADR-0058）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const legend = legendOf(page)
  // 未解释 / 未证实 / 违规是写在线上的字，图例不列；缺段是选中交互才画出的临时记号，在脚注
  for (const t of ['未解释', '违规', '未证实']) await expect(legend.locator(`[data-tag="${t}"]`)).toHaveCount(0)
  await expect(legend.getByTestId('carrier-legend')).toHaveCount(0)
  await legend.getByTestId('legend-temp').click()
  await expect(legend.getByTestId('carrier-legend')).toContainText('承载叠加')
  await legend.getByTestId('legend-temp').click()
  const facts = legend.getByRole('switch', { name: '代码事实' })
  await expect(facts).toHaveAttribute('aria-checked', 'true')
  await expect(legend.getByRole('switch', { name: '组装' })).toHaveAttribute('aria-checked', 'false')
  await facts.click()
  await expect(facts).toHaveAttribute('aria-checked', 'false')
  await expect(legend.locator('[data-tag]')).toHaveCount(0)
  const factsCorner = page.getByTestId('facts-off-corner')
  await expect(factsCorner).toHaveText(/代码事实已关 · 隐藏 \d+ 处标记/)
  await expect(factsCorner).toHaveAttribute('title', /未证实关系的「\?」标签/)
  await expect(factsCorner).toHaveAttribute('title', /违规视图边的红晕/)
  await factsCorner.click()
  await expect(facts).toHaveAttribute('aria-checked', 'true')
  await expect(factsCorner).toHaveCount(0)
})

test('L48：图例收起后记在本机，重新进入仍收起；L51：「线」一节标题旁的「?」打开帮助的「读一条线」', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const legend = legendOf(page)
  await legend.getByRole('button', { name: '怎么读一条线' }).click()
  const guide = page.getByRole('dialog', { name: '怎么读这张图' })
  await expect(guide.getByLabel('读一条线：三问四修饰')).toBeInViewport()
  await expect(guide).toContainText('被调方拥有后果吗？')
  await page.keyboard.press('Escape')
  await legend.locator('.head-btn').click()
  await expect(legend.locator('.head-btn')).toHaveAttribute('aria-expanded', 'false')
  await page.reload()
  await expect(legendOf(page).locator('.head-btn')).toHaveAttribute('aria-expanded', 'false')
})

test('L50：悬停一条交互线，提示末尾附上它的图例释义', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const tips = await page.locator('.vue-flow__edges g > title').allTextContents()
  expect(tips.length).toBeGreaterThan(0)
  expect(tips.some(t => /图例 · (查询|委托|通知|流|未分类) = /.test(t))).toBe(true)
})

test('时序图图例在时序图标签内容区顶部的「图例」里（WS-10）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await page.getByRole('button', { name: '时序图图例' }).click()
  await expect(page.getByRole('note', { name: '时序图图例' })).toContainText('同步调用')
  await expect(legendOf(page)).not.toContainText('同步调用')
})
