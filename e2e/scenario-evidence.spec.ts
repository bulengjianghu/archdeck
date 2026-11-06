/** 场景证据（S15、D-20）：场景面板的「证据」一节列出文件并可在资料区预览；场景列表给有证据的场景标「测试 N」（N 为证据文件数） */
import { expect, test } from '@playwright/test'
import { openDesk } from './helpers'

test('打开自身的场景：面板有「证据」一节，单击文件在资料区预览源码；场景列表标「测试 N」', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  // 场景面板住辅助栏步骤节（第二十轮 §6）
  const side = page.getByTestId('dock-step-side')
  const section = side.locator('.scenario-panel .section').filter({ has: page.locator('h3', { hasText: '证据' }) })
  // 代码事实晚到时证据清单才出现；「证据与清单」折叠块缺省关闭——重试到清单真正可见（并发负载下首读源码可能超过 10s）
  await expect(async () => {
    const foldSummary = side.locator('[data-testid="check-lists-fold"]').first()
    if (await foldSummary.count()) {
      const details = foldSummary.locator('xpath=..')
      if ((await details.evaluate(el => (el as unknown as { open: boolean }).open)) !== true) await foldSummary.click()
    }
    await expect(section.getByRole('button', { name: 'tests/acceptance/run-perspective.test.ts' })).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  await expect(section.locator('.missing')).toHaveCount(0)
  await section.getByRole('button', { name: 'e2e/run-default.spec.ts' }).scrollIntoViewIfNeeded()
  await section.getByRole('button', { name: 'e2e/run-default.spec.ts' }).click()
  await expect(page.locator('.dock .tab.on')).toContainText('run-default.spec.ts')
  // 全量并行跑时首次读源码与加载语法可能超过 10s，留足余量
  await expect(page.locator('.source-view')).toContainText('导航树是浮层抽屉', { timeout: 20_000 })
  await page.getByRole('button', { name: /^运行 · / }).click()
  // 每个声明了证据的场景各标一个（「打开场景并回放」「在画布上编辑草图并保存」）
  await expect(page.locator('.scenario-list .item .evidence')).toHaveCount(2)
  const tag = page.locator('.scenario-list .item', { hasText: '打开场景并回放' }).locator('.evidence')
  await expect(tag).toHaveCount(1)
  await expect(tag).toHaveText(/^\s*测试 \d+$/)
})
