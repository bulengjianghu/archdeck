/** 场景证据（S15、D-20）：场景面板的「证据」一节列出文件并可在资料区预览；场景列表给有证据的场景标「测试 N」（N 为证据文件数） */
import { expect, test } from '@playwright/test'
import { openDesk, openPanelLists, openPropsDrawer } from './helpers'

test('打开自身的场景：面板有「证据」一节，单击文件在资料区预览源码；场景列表标「测试 N」', async ({ page }) => {
  // 打开画布、展开证据、单击预览三处都按负载预算重试，60 s 不够
  test.setTimeout(120_000)
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  // 第二十轮 §4：运行视角抽屉自动收起，场景面板在抽屉里
  await openPropsDrawer(page)
  // ADR-0060：证据是核对卡的清单，在「证据与清单」折叠块里（面板在辅助栏步骤节，抽屉里那份不是它）
  const side2 = page.getByTestId('dock-step-side')
  const foldSummary = side2.locator('[data-testid="check-lists-fold"]').first()
  // 第二十一轮波 1 绕开（第二十轮缺陷 02-review §2.5）：步骤节晚于抽屉渲染时，不等就 count() 会跳过展开、证据一节保持折叠——先等场景面板出现
  await expect(side2.locator('.scenario-panel')).toBeVisible()
  if (await foldSummary.count()) {
    const details = foldSummary.locator('xpath=..')
    if ((await details.evaluate(el => (el as unknown as { open: boolean }).open)) !== true) await foldSummary.click()
  }
  await openPanelLists(page)
  const side = page.getByTestId('dock-step-side')
  const section = side.locator('.scenario-panel .section').filter({ has: page.locator('h3', { hasText: '证据' }) })
  // 步骤节限高 45%、内部滚动：证据清单在下方，先滚到它
  // 第二十一轮波 4 再收紧（第二十轮已知偶发）：折叠块可能在上面 count() 之后才渲染、证据一节仍折叠——重试「展开 → 滚到 → 可见」直到成立
  await expect(async () => {
    if (await foldSummary.count()) {
      const details = foldSummary.locator('xpath=..')
      if ((await details.evaluate(el => (el as unknown as { open: boolean }).open)) !== true) await foldSummary.click()
    }
    await section.evaluate(el => el.scrollIntoView({ block: 'start' }))
    await expect(section).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await expect(section.getByRole('button', { name: 'tests/acceptance/run-perspective.test.ts' })).toBeVisible()
  await expect(section.locator('.missing')).toHaveCount(0)
  // 收尾复跑（第二十轮已知偶发再收紧）：负载下别的用例改描述，面板随重新加载重绘、按钮被换掉，单击一直重试到用例超时——滚到、短超时单击、看标签，按 toPass 重试
  const evidence = section.getByRole('button', { name: 'e2e/run-default.spec.ts' })
  await expect(async () => {
    await evidence.evaluate(el => el.scrollIntoView({ block: 'center' }))
    await evidence.click({ timeout: 3_000 })
    await expect(page.locator('.dock .tab.on')).toContainText('run-default.spec.ts', { timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  // 全量并行跑时首次读源码与加载语法可能超过 10s，留足余量
  await expect(page.locator('.source-view')).toContainText('导航树是浮层抽屉', { timeout: 20_000 })
  await page.getByRole('button', { name: /^运行 · / }).click()
  // 每个声明了证据的场景各标一个（「打开场景并回放」「在画布上编辑草图并保存」）
  await expect(page.locator('.scenario-list .item .evidence')).toHaveCount(2)
  const tag = page.locator('.scenario-list .item', { hasText: '打开场景并回放' }).locator('.evidence')
  await expect(tag).toHaveCount(1)
  await expect(tag).toHaveText(/^\s*测试 \d+$/)
})
