/** 「显示」面板（W-2、ADR-0017、L45）：上「设置」下「图例」两块；设置块收编全部开关与筛选（按对象分组、行上互指记号），图例只读；按视角只出现能用的开关，折叠时摘要列出非默认设置；隐藏画布内容的开关在画布角留痕计数、单击撤销；运行视角默认只展开「回放」；时序图图例在副栏「图例」 */
import { expect, test } from '@playwright/test'
import { openDesk } from './helpers'

test('交互视角：类型行是纯图例（不再点击筛选），筛选在设置块；隐藏时画布角留痕、单击恢复；折叠后摘要列出', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const panel = page.getByRole('region', { name: '显示' })
  // ADR-0029 §3：三问四修饰——三个判断题定类型；类型行只读（L45：一行不兼两职）；修饰（机制、异步、拉取）与粗细在「四修饰」卡片（不可点击）
  const questions = panel.getByRole('list', { name: '三问定类型' })
  await expect(questions.getByRole('listitem')).toHaveCount(3)
  await expect(questions).toContainText('被调方拥有后果吗？否 → 查询')
  await expect(questions).toContainText('是：发起方知道接收方吗？知道 → 委托；不知道、一对多 → 通知')
  await expect(questions).toContainText('传的是连续数据吗？是 → 流')
  const reading = panel.getByLabel('四修饰')
  await expect(reading).toContainText('直接')
  await expect(reading).toContainText('端口')
  await expect(reading).toContainText('异步')
  await expect(reading).toContainText('拉取')
  await expect(reading).toContainText('≥5')
  await expect(reading.getByRole('button')).toHaveCount(0)
  // L12：端口的示意带插座记号
  await expect(reading.locator('marker.socket-marker')).toHaveCount(1)
  // ADR-0035：代码事实写在标签位，不再有「实线 = 已证实」；线型只有实线 = 交互、虚线 = 依赖（共享组）
  await expect(panel.getByText('实线 = 已证实', { exact: false })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: /代码事实 · 标签/ })).toBeVisible()
  // L45：图例的类型行不可点击；组标题旁互指；筛选与开关在设置块
  await expect(panel.locator('.type-list').getByRole('button')).toHaveCount(0)
  await expect(panel.getByText('筛选在设置 · 关系筛选')).toBeVisible()
  await expect(panel.getByText('开关在设置 · 代码事实')).toBeVisible()
  const settings = panel.getByLabel('设置', { exact: true })
  const unclassified = settings.getByRole('checkbox', { name: '关系类型：未分类' })
  await unclassified.uncheck()
  // 隐藏必留痕（L45）：画布角出现计数，单击恢复
  const corner = page.getByTestId('filter-corner')
  await expect(corner).toHaveText('隐藏 1 类关系')
  await corner.click()
  await expect(unclassified).toBeChecked()
  await expect(corner).toHaveCount(0)
  // 再隐藏一次，折叠摘要列出
  await unclassified.uncheck()
  await expect(corner).toHaveText('隐藏 1 类关系')
  await panel.getByLabel('边界节点').uncheck()
  await panel.getByRole('button', { name: /^显示/ }).click()
  await expect(panel.getByRole('button', { name: /^显示/ })).toContainText('隐藏 1 类关系 · 无边界节点')
  // 顶部工具栏不再有显示开关
  await expect(page.locator('.toolbar input[type=checkbox]')).toHaveCount(0)
})

test('运行视角：交互关系显示方式在设置块里，结构类开关不出现（L9）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  const panel = page.getByRole('region', { name: '显示' })
  await panel.getByRole('button', { name: /^显示/ }).click()
  await expect(panel.getByLabel('边界节点')).toHaveCount(0)
  await expect(panel.getByText('关系筛选')).toHaveCount(0)
  // 运行视角默认只展开「回放」
  await expect(panel.getByRole('button', { name: /关系/ })).toHaveAttribute('aria-expanded', 'false')
  await expect(panel).toContainText('当前步骤（沿消息方向流动）')
  await expect(panel).not.toContainText('委托 = 交出控制权')
  await panel.getByRole('button', { name: '淡显' }).click()
  await expect(panel.getByRole('button', { name: '淡显' })).toHaveAttribute('aria-pressed', 'true')
  await panel.getByRole('button', { name: /^显示/ }).click()
  await expect(panel.getByRole('button', { name: /^显示/ })).toContainText('交互关系：淡显')
})

test('结构视角（L19、L21、L45）：图例整组换成「依赖 · 形态与档」，开关在设置块「结构筛选与表面」组、带收起计数；代码事实与关系筛选组不出现', async ({
  page,
}) => {
  await openDesk(page, '/p/h5p-arch-desk?v=s')
  const panel = page.getByRole('region', { name: '显示' })
  await expect(panel.getByRole('button', { name: /依赖 · 形态与档/ })).toBeVisible()
  await expect(panel.getByRole('button', { name: /规则叠加/ })).toBeVisible()
  await expect(panel.getByRole('button', { name: /指标 · 不稳定度/ })).toBeVisible()
  // L16（ADR-0035）：全部虚线，形态只靠端点记号，端口实现为 ◇
  for (const t of ['子类 = 虚线 + 空心三角', '组装 = 虚线 + 实心菱形', '端口实现 = 虚线 + 空心菱形 ◇', '使用 = 虚线 + 开口箭头'])
    await expect(panel).toContainText(t)
  await expect(panel.getByTestId('bundle-note')).toContainText('一对模块之间画一条束，线宽按束内元素级边条数；形态不止一种时标 ×N 元素')
  await expect(panel.getByLabel('表面元素四类')).toContainText('端口')
  await expect(panel).toContainText('越过入口')
  await expect(panel.getByText('关系筛选')).toHaveCount(0)
  await expect(panel.getByText('代码事实与组装')).toHaveCount(0)
  // L45：开关迁到设置块「结构筛选与表面」组；图例组标题旁互指
  await expect(panel.getByText('开关在设置 · 结构筛选与表面')).toBeVisible()
  // 只引类型缺省收起：本层条数在设置块；打开开关后改为「已显示」，折叠摘要列出
  const count = panel.getByTestId('type-only-count')
  await expect(count).toContainText(/只引类型（点线） · \d+ 条已收起/)
  const n = (await count.textContent())!.match(/(\d+) 条已收起/)![1]
  await panel.getByRole('switch', { name: '只引类型' }).check()
  await expect(count).toContainText(`只引类型（点线） · ${n} 条已显示`)
  // 只看交互使用、只看未解释：关着时给出打开后会收起的条数，打开后为已收起
  const value = panel.getByTestId('value-count')
  await expect(value).toContainText(/打开后收起值使用的束 \d+ 条/)
  const v = (await value.textContent())!.match(/值使用的束 (\d+) 条/)![1]
  await panel.getByRole('switch', { name: '只看交互使用' }).check()
  await expect(value).toContainText(`值使用的束 ${v} 条已收起`)
  const unc = panel.getByTestId('uncovered-count')
  await expect(unc).toContainText(/打开后收起已解释的束 \d+ 条/)
  await panel.getByRole('switch', { name: '只看未解释' }).check()
  await expect(unc).toContainText(/已解释的束 \d+ 条已收起/)
  await panel.getByRole('switch', { name: '总是展开表面' }).check()
  await expect(panel.getByTestId('cross-count')).toContainText(/一端是边界节点的束 \d+ 条折叠/)
  await panel.getByRole('button', { name: /^显示/ }).click()
  await expect(panel.getByRole('button', { name: /^显示/ })).toContainText('只引类型已显示 · 只看交互使用 · 只看未解释 · 总是展开表面')
  await panel.getByRole('button', { name: /^显示/ }).click()
  for (const name of ['只引类型', '只看交互使用', '只看未解释', '总是展开表面']) await panel.getByRole('switch', { name }).uncheck()
  await expect(count).toContainText(`只引类型（点线） · ${n} 条已收起`)
})

test('交互视角「代码事实 · 标签」组：标签词表与承载叠加一句（L22、L26）；开关在设置块', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const panel = page.getByRole('region', { name: '显示' })
  await expect(panel.getByTestId('carrier-legend')).toContainText('承载叠加')
  await expect(panel.getByTestId('carrier-legend')).toContainText('缺段')
  for (const t of ['未证实', '违规', '未解释']) await expect(panel.locator(`[data-tag="${t}"]`)).toBeVisible()
  // L45：代码事实与组装的开关在设置块的「代码事实与组装」组
  const settings = panel.getByLabel('设置', { exact: true })
  await expect(settings.getByRole('switch', { name: '代码事实' })).toBeChecked()
  await expect(settings.getByRole('switch', { name: '组装' })).not.toBeChecked()
  // 关闭代码事实：图例组给去向说明，画布角留痕（有可标异常时）或无计数
  await settings.getByRole('switch', { name: '代码事实' }).uncheck()
  await expect(panel.getByRole('button', { name: /代码事实 · 标签/ })).toBeVisible()
  await expect(settings.getByRole('switch', { name: '代码事实' })).not.toBeChecked()
  await settings.getByRole('switch', { name: '代码事实' }).check()
})

test('时序图图例在副栏标题栏的「图例」里', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await page.getByRole('button', { name: '时序图图例' }).click()
  await expect(page.getByRole('note', { name: '时序图图例' })).toContainText('同步调用')
  await expect(page.getByRole('region', { name: '显示' })).not.toContainText('同步')
})
