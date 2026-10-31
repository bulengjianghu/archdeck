/**
 * 演化事实（§6.12，HS-4、J5–J7）：图例「演化」组的开关行缺省关闭（L45）；「显示 ▾」选口径「缺陷」、图例打开热度后节点出现热度角标并记在本地（L49）；系统面板列出热度前 10；
 * 开「时间耦合」后本层出现波浪线，单击选中它看面板。以 h5p-arch-desk 自身验收（源码在本地、是 git 仓库）。
 */
import { expect, test } from '@playwright/test'
import { openCheckList, openDesk, query } from './helpers'

test('缺省关闭：没有角标与耦合线；开启「缺陷」热度后出现角标，刷新后仍开启；运行视角不叠加', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=present')
  const panel = page.getByRole('region', { name: '图例' })
  const heat = panel.getByRole('switch', { name: '演化热度' })
  await expect(heat).toHaveAttribute('aria-checked', 'false')
  await expect(page.locator('.heat-badge')).toHaveCount(0)
  await expect(page.locator('.edge-couple')).toHaveCount(0)
  // L49：口径在「显示 ▾」——热度关着时只记下、不打开
  await page.getByRole('button', { name: /^显示 ▾/ }).click()
  await page.getByRole('group', { name: '热度口径' }).getByRole('button', { name: '缺陷' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.heat-badge')).toHaveCount(0)
  // L45：图例的热度行即开关，打开为记住的口径
  await heat.click()
  await expect(heat).toHaveAttribute('aria-checked', 'true')
  await expect(heat).toContainText('缺陷')
  await expect(page.locator('.heat-badge').first()).toBeVisible()
  await expect(panel).toContainText('高（本层分档）')
  await expect(page.getByTestId('display-summary')).toHaveAttribute('data-summary', new RegExp('热度：缺陷'))
  // 记在本地：刷新后仍开启
  await page.reload()
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.heat-badge').first()).toBeVisible()
  // 运行视角不叠加
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await expect(page.locator('.heat-badge')).toHaveCount(0)
  await expect(page.getByRole('region', { name: '图例' }).getByRole('switch', { name: '演化热度' })).toHaveCount(0)
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
  // ADR-0052：呈现层声明了分层，带内同层成员之间的耦合不画；在普通层次「画布」里看
  await openDesk(page, '/p/h5p-arch-desk?level=present.canvas')
  const panel = page.getByRole('region', { name: '图例' })
  await panel.getByRole('switch', { name: '时间耦合' }).click()
  // F7（L44）：时间耦合按需显示——静息态只在画布角计数，选中一端时画出
  await expect(page.getByTestId('couple-corner')).toContainText(/时间耦合 \d+ 对/)
  await expect(page.locator('.edge-couple')).toHaveCount(0)
  await openDesk(page, '/p/h5p-arch-desk?level=present.canvas&sel=m:present.canvas.flow')
  const line = page.locator('.edge-couple').first()
  await expect(line).toBeVisible()
  await expect(page.locator('.edge-couple .vue-flow__edge-text').first()).toContainText('×')
  // 波浪线的标签浮在边上，直接在标签上派发单击
  await page.locator('.edge-couple .vue-flow__edge-text').first().dispatchEvent('click')
  await expect.poll(() => query(page).get('sel')).toMatch(/^c:.+~.+$/)
  await expect(page.locator('.couple-panel')).toContainText('同提交')
  await expect(page.locator('.couple-panel')).toContainText('共同的提交')
  // 模块的提交历史是核对卡的清单（PC-8），展开后列出提交（先收起右上角的图例，免得它盖住节点）
  const head = panel.locator('.head-btn')
  if ((await head.getAttribute('aria-expanded')) === 'true') await head.click()
  await page.locator('.vue-flow__node[data-id="present.canvas.flow"]').click()
  await openCheckList(page, 'evidence.evolution')
  await expect(page.locator('.panel')).toContainText('最近 10 次提交')
})
