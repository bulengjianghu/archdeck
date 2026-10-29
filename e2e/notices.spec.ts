/** 面板骨架 ③「需要注意」（G11、V15b）：每一行单击跳到对应节——折叠的节自动展开、滚动到视口内并闪一次 */
import { expect, test } from '@playwright/test'
import { openDesk, waitSettled } from './helpers'

test('③ 需要注意：逐行单击跳到对应节，目标节展开并进入视口', async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 1100 })
  await openDesk(page, '/p/h5player?level=app&sel=m:app.solution&v=s')
  await waitSettled(page)
  await page.waitForSelector('[data-sec="boundary.structure"]', { timeout: 20_000 })
  const rows = page.locator('[data-sec="notices"] button.notice')
  const n = await rows.count()
  expect(n, 'h5player app.solution 应有异常行').toBeGreaterThan(0)
  for (let i = 0; i < n; i++) {
    // 上一次跳转的闪烁类留在原节上，先清掉，只认这一次的目标
    await page.evaluate(() => document.querySelectorAll('.jump-flash').forEach(el => el.classList.remove('jump-flash')))
    const key = await rows.nth(i).getAttribute('data-notice')
    await rows.nth(i).click()
    const target = page.locator('.panel .jump-flash')
    await expect(target, `③ 行 ${key}`).toHaveCount(1)
    await expect(target, `③ 行 ${key}`).toBeInViewport()
    // 折叠节自动展开（目标节自己的折叠按钮不再是收起态）
    await expect(target.locator('.fold[aria-expanded="false"]').first()).toHaveCount(0)
    await page.locator('[data-sec="notices"]').scrollIntoViewIfNeeded()
  }
})
