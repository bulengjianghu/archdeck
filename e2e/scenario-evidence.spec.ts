/** 场景证据（S15、D-20）：场景面板的「证据」一节列出文件并可在资料区预览；场景列表给有证据的场景标「测试 N」（N 为证据文件数） */
import { expect, test } from '@playwright/test'
import { activeTab, openDesk, showView } from './helpers'

test('打开自身的场景：面板有「证据」一节，单击文件在资料区预览源码；场景列表标「测试 N」', async ({ page }) => {
  // 打开画布、展开证据、单击预览三处都按负载预算重试，60 s 不够
  test.setTimeout(120_000)
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  // LY-13：场景面板的核对卡（证据）在核对标签的步骤节
  await showView(page, 'check')
  const side = page.getByTestId('check-step-side')
  const section = side.locator('.scenario-panel .section').filter({ has: page.locator('h3', { hasText: '证据' }) })
  // 代码事实晚到时证据清单才出现；「证据与清单」折叠块缺省关闭——重试到清单真正可见（并发负载下首读源码可能超过 10s）
  // 合并复跑：面板随描述重新加载重绘后折叠块回到关闭——展开写成函数，单击证据的重试里也先展开
  const unfold = async () => {
    const foldSummary = side.locator('[data-testid="check-lists-fold"]').first()
    if (await foldSummary.count()) {
      const details = foldSummary.locator('xpath=..')
      if ((await details.evaluate(el => (el as unknown as { open: boolean }).open)) !== true) await foldSummary.click()
    }
  }
  await expect(async () => {
    await unfold()
    await expect(section.getByRole('button', { name: 'tests/acceptance/run-perspective.test.ts' })).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  await expect(section.locator('.missing')).toHaveCount(0)
  // 收尾复跑（第二十一轮，第二十轮已知偶发再收紧）：负载下别的用例改描述，面板随重新加载重绘、按钮被换掉，单击一直重试到用例超时——滚到、短超时单击、看标签，按 toPass 重试
  const evidence = section.getByRole('button', { name: 'e2e/playback.spec.ts' })
  await expect(async () => {
    await unfold()
    await evidence.evaluate(el => el.scrollIntoView({ block: 'center' }), undefined, { timeout: 3_000 })
    await evidence.click({ timeout: 3_000 })
    await expect(activeTab(page, 0)).toContainText('playback.spec.ts', { timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  // 全量并行跑时首次读源码与加载语法可能超过 10s，留足余量
  await expect(page.locator('.source-view')).toContainText('回放主路径', { timeout: 20_000 })
  await page.locator('[data-scene-chip] .t').click()
  // 每个声明了证据的场景各标一个（「打开场景并回放」「在画布上编辑草图并保存」）
  await expect(page.locator('.scenario-list .item .evidence')).toHaveCount(2)
  const tag = page.locator('.scenario-list .item', { hasText: '打开场景并回放' }).locator('.evidence')
  await expect(tag).toHaveCount(1)
  await expect(tag).toHaveText(/^\s*测试 \d+$/)
})
