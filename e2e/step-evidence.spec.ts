/** 步骤的代码证据（S16–S18、D-21）：步骤面板列出候选调用点、单击在资料区滚到该行；无证据的步骤在时序图带「?」并进问题页签 */
import { expect, test } from '@playwright/test'
import { openCheckList, openDesk } from './helpers'

test('单步到 transition(openScenario)：面板按名字匹配到 useDeskState.ts 的一行，单击在资料区预览并滚到该行', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  // 从开头单步，直到选中 transition(openScenario) 那一步
  const title = page.locator('.step-panel h2')
  for (let i = 0; i < 10 && !((await title.count()) && (await title.textContent())?.startsWith('transition(openScenario)')); i++)
    await page.getByRole('button', { name: /下一步/ }).click()
  await expect(title).toHaveText(/^transition\(openScenario\)/)
  // PC-10：代码证据在步骤的核对卡里
  await openCheckList(page)

  const section = page.locator('.step-panel .section').filter({ has: page.locator('h3', { hasText: '代码证据' }) })
  // D-25、S18b：证据等级之上只有一条链「这一步 → 交互（承载判定词）→ 承载段（文件:行）」，等级与判定同一个词（裁决 T0-10）
  const chain = section.getByRole('list', { name: '包含链' })
  await expect(chain).toContainText('这一步')
  await expect(chain.locator('.link-interaction')).toContainText('交互')
  await expect(chain.locator('.link-interaction .verdict')).toHaveText('齐全')
  await expect(chain.locator('.link-carrier')).toContainText('直接：各段都接到元素')
  await expect(chain.locator('.link-segment').first()).toContainText(/useDeskState\.ts:\d+/)
  await expect(chain.locator('.link-dependency')).toHaveCount(0)
  await expect(section.locator('.evidence-level .badge')).toHaveText('按名字匹配')
  await expect(section).toContainText('导入名含接口名「transition」')
  const candidate = section.locator('.candidates').getByRole('button', { name: /^src\/state\/useDeskState\.ts:\d+$/ })
  await expect(candidate).toHaveCount(1)
  const line = Number((await candidate.textContent())!.split(':')[1])

  await candidate.click()
  await expect(page.locator('.dock .tab.on')).toContainText('useDeskState.ts')
  // 全量并行跑时首次读源码与加载语法可能超过 10s，留足余量
  const target = page.locator('.source-view .line.target')
  await expect(target).toHaveCount(1, { timeout: 20_000 })
  await expect(target).toBeInViewport()
  expect(await target.evaluate(el => [...el.parentElement!.querySelectorAll('.line')].indexOf(el) + 1)).toBe(line)
  // 步骤面板保持（只预览、不改变选中）
  await expect(title).toHaveText(/^transition\(openScenario\)/)
})

test('无证据（无承载）的步骤：时序图消息带「?」，场景面板计数、场景列表「? N」，问题页签有「步骤无证据」', async ({ page }) => {
  await openDesk(page, '/p/h5player?sc=sc.timeshift-leg-switch')
  await expect(page.locator('svg .no-evidence').first()).toBeVisible({ timeout: 20_000 })
  const section = page.locator('.scenario-panel .section').filter({ has: page.locator('h3', { hasText: '证据' }) })
  await expect(section).toContainText(/无证据 [1-9]/)
  await page.getByRole('button', { name: /^运行：/ }).click()
  await expect(page.locator('.scenario-list .item .unevidenced').first()).toHaveText(/\? \d+/)
  await page.keyboard.press('Escape')
  // 运行视角下导航树缺省收起（W-1）
  await page.getByRole('button', { name: '展开导航树' }).click()
  await page.getByRole('tab', { name: /问题/ }).click()
  await page.getByRole('combobox', { name: '按类别筛选' }).selectOption('unevidenced')
  await expect(page.locator('.nav-tree .item .title').first()).toContainText('步骤无证据')
})
