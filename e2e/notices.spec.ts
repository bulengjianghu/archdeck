/** 核对卡的异常条目（V15b、PC-7）：有 ⚠ 行时核对卡自动展开；每条带跳转目标的条目单击跳到对应清单——折叠的清单自动展开、滚动到视口内并闪一次 */
import { expect, test } from '@playwright/test'
import { openDesk, openPanelLists, waitSettled } from './helpers'

test('核对卡：有异常自动展开，异常条目逐条单击跳到对应清单，目标展开并进入视口', async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 1100 })
  await openDesk(page, '/p/h5player?level=app&sel=m:app.solution&v=s')
  await waitSettled(page)
  await openPanelLists(page) // ADR-0060：证据与清单缺省折叠
  await page.waitForSelector('[data-sec="boundary.structure"]', { timeout: 20_000 })
  const card = page.locator('.panel [data-card="check"]')
  await expect(card.locator('.card-toggle')).toHaveAttribute('aria-expanded', 'true')
  await expect(card.locator('.card-sum')).toHaveText(/^⚠ \d+ 项要看/)
  const items = card.locator('[data-check-item][data-target]')
  const n = await items.count()
  expect(n, 'h5player app.solution 应有带跳转目标的异常条目').toBeGreaterThan(0)
  for (let i = 0; i < n; i++) {
    // 上一次跳转的闪烁类留在原清单上，先清掉，只认这一次的目标
    await page.evaluate(`document.querySelectorAll('.jump-flash').forEach(el => el.classList.remove('jump-flash'))`)
    const key = `${await items.nth(i).getAttribute('data-check-item')} → ${await items.nth(i).getAttribute('data-target')}`
    await items.nth(i).click()
    const target = page.locator('.panel .jump-flash')
    await expect(target, key).toHaveCount(1)
    await expect(target, key).toBeInViewport()
    // 折叠的清单自动展开（目标自己的折叠按钮不再是收起态）
    await expect(target.locator('.fold[aria-expanded="false"]').first()).toHaveCount(0)
    await card.scrollIntoViewIfNeeded()
  }
})
