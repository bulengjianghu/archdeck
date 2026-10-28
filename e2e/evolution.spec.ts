/**
 * 演化事实（§6.12，HS-4、J5–J7）：「显示」面板「演化」组缺省关闭；开「缺陷」后节点出现热度角标并记在本地；系统面板列出热度前 10；
 * 开「时间耦合」后本层出现波浪线，单击选中它看面板。以 h5p-arch-desk 自身验收（源码在本地、是 git 仓库）。
 */
import { expect, test } from '@playwright/test'
import { openDesk, query } from './helpers'

test('缺省关闭：没有角标与耦合线；开启「缺陷」热度后出现角标，刷新后仍开启；运行视角不叠加', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=present')
  const panel = page.getByRole('region', { name: '显示' })
  await expect(panel.getByRole('group', { name: '热度' })).toBeVisible()
  await expect(page.locator('.heat-badge')).toHaveCount(0)
  await expect(page.locator('.edge-couple')).toHaveCount(0)
  await panel.getByRole('group', { name: '热度' }).getByRole('button', { name: '缺陷' }).click()
  await expect(page.locator('.heat-badge').first()).toBeVisible()
  await expect(panel).toContainText('高（缺陷热度，本层分档）')
  // 折叠后摘要列出
  await panel.getByRole('button', { name: /^显示/ }).click()
  await expect(panel.getByRole('button', { name: /^显示/ })).toContainText('热度：缺陷')
  // 记在本地：刷新后仍开启
  await page.reload()
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.heat-badge').first()).toBeVisible()
  // 运行视角不叠加
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await expect(page.locator('.heat-badge')).toHaveCount(0)
  await expect(page.getByRole('region', { name: '显示' }).getByRole('group', { name: '热度' })).toHaveCount(0)
})

test('系统面板「演化」列出热度前 10；模块树可按热度排序', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const panel = page.locator('.panel')
  await expect(panel).toContainText('演化（git 历史）')
  // G11 V15c：系统面板的演化与模块层同规——默认折叠带计数，展开再断言
  await panel.getByRole('button', { name: /^▸ 演化（git 历史）/ }).click()
  await expect(panel).toContainText(/修改热度前 10/)
  await expect(panel.locator('.top li')).toHaveCount(10)
  // 两种口径分开写（J4）：总数含上级并集，清单只列最具体的对
  await expect(panel).toContainText(/时间耦合 \d+ 对（含上级并集）/)
  await expect(panel).toContainText('无依赖无关系的时间耦合（只列最具体的对）')
  const sort = page.getByRole('group', { name: '模块排序' })
  await sort.getByRole('button', { name: '按热度' }).click()
  await expect(sort.getByRole('button', { name: '按热度' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.tree .heat').first()).toBeVisible()
})

test('开启时间耦合：本层出现波浪线，单击选中它，地址带 sel=c:，面板列出共同的提交；关系面板标「同提交 ×N」', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=present')
  const panel = page.getByRole('region', { name: '显示' })
  await panel.getByLabel('时间耦合').check()
  const line = page.locator('.edge-couple').first()
  await expect(line).toBeVisible()
  await expect(page.locator('.edge-couple .vue-flow__edge-text').first()).toContainText('×')
  // 波浪线的标签浮在边上，直接在标签上派发单击
  await page.locator('.edge-couple .vue-flow__edge-text').first().dispatchEvent('click')
  await expect.poll(() => query(page).get('sel')).toMatch(/^c:.+~.+$/)
  await expect(page.locator('.couple-panel')).toContainText('同提交')
  await expect(page.locator('.couple-panel')).toContainText('共同的提交')
  // 模块面板的「演化」一节默认折叠，展开后列出提交（先收起右下角的「显示」面板，免得它盖住节点）
  const head = panel.locator('.head-btn')
  if ((await head.getAttribute('aria-expanded')) === 'true') await head.click()
  await page.locator('.vue-flow__node[data-id="present.panel"]').click()
  await expect(page.locator('.panel')).toContainText('演化')
  await page
    .locator('.panel')
    .getByRole('button', { name: /^▸ 演化/ })
    .click()
  await expect(page.locator('.panel')).toContainText('最近 10 次提交')
})
