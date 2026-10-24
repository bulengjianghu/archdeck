/** 「显示」面板（W-2、ADR-0017）：先设置后图例；按视角只出现能用的开关，折叠时摘要列出非默认设置；运行视角默认只展开「回放」；时序图图例在副栏「图例」 */
import { expect, test } from '@playwright/test'
import { openDesk } from './helpers'

test('结构视角：关系类型筛选与边界节点开关在面板里，折叠后摘要列出', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const panel = page.getByRole('region', { name: '显示' })
  // ADR-0029 §3：三问四修饰——三个判断题定类型，类型行是图例也是筛选；修饰（机制、异步、拉取）与粗细在「四修饰」卡片（不可点击），线型只在「代码事实」组讲
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
  await expect(panel.getByText('实线 = 已证实', { exact: false })).toHaveCount(1)
  const types = panel.getByRole('group', { name: '关系类型筛选' })
  await expect(types).toContainText('查询 = 要结果、无副作用')
  await expect(types).toContainText('委托 = 交出控制权')
  await expect(types).toContainText('通知 = 不要结果、一对多，一律异步')
  await expect(types).toContainText('流 = 连续数据，箭头指向数据去向')
  // ADR-0029：没有「实现契约」「依赖」；迁移期的未分类单列
  await expect(types.getByRole('button', { name: /依赖|实现契约/ })).toHaveCount(0)
  const unclassified = types.getByRole('button', { name: /未分类/ })
  await unclassified.click()
  await expect(unclassified).toHaveAttribute('aria-pressed', 'false')
  await panel.getByLabel('边界节点').uncheck()
  await panel.getByRole('button', { name: /^显示/ }).click()
  await expect(panel.getByRole('button', { name: /^显示/ })).toContainText('隐藏 1 类关系 · 无边界节点')
  // 顶部工具栏不再有显示开关
  await expect(page.locator('.toolbar input[type=checkbox]')).toHaveCount(0)
})

test('运行视角：静态关系显示方式在面板里，结构类开关不出现', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  const panel = page.getByRole('region', { name: '显示' })
  await panel.getByRole('button', { name: /^显示/ }).click()
  await expect(panel.getByLabel('边界节点')).toHaveCount(0)
  await expect(panel.getByRole('group', { name: '关系类型筛选' })).toHaveCount(0)
  // 运行视角默认只展开「回放」
  await expect(panel.getByRole('button', { name: /关系/ })).toHaveAttribute('aria-expanded', 'false')
  await expect(panel).toContainText('当前步骤（沿消息方向流动）')
  await expect(panel).not.toContainText('委托 = 交出控制权')
  await panel.getByRole('button', { name: '淡显' }).click()
  await expect(panel.getByRole('button', { name: '淡显' })).toHaveAttribute('aria-pressed', 'true')
  await panel.getByRole('button', { name: /^显示/ }).click()
  await expect(panel.getByRole('button', { name: /^显示/ })).toContainText('静态关系：淡显')
})

test('时序图图例在副栏标题栏的「图例」里', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await page.getByRole('button', { name: '时序图图例' }).click()
  await expect(page.getByRole('note', { name: '时序图图例' })).toContainText('同步调用')
  await expect(page.getByRole('region', { name: '显示' })).not.toContainText('同步')
})
