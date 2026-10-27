/**
 * 第十一轮 S2（ADR-0037）：选中只聚焦一跳、悬停叠加（L27），影响面是面板里的一次性查询（K15b、K15c），传入闭包标可能波及（K15d）。
 * 以 media-web-player 的分层总览验收（01 §6.24）。
 */
import { expect, test, type Page } from '@playwright/test'
import { graphNode, openDesk, query } from './helpers'

/** 结构边是否变淡：DepEdge 变淡时线的不透明度降到 0.12（同 structure-view.spec） */
const faded = async (page: Page, id: string) => (await page.locator(`.vue-flow__edge-dep[data-id="${id}"] path[style*="opacity: 0.12"]`).count()) > 0
const nodeFaded = (page: Page, id: string) => graphNode(page, id).locator('.dim').count()
const marks = (page: Page) => page.getByTestId('impact-mark')
const choice = (page: Page, c: 'none' | 'in' | 'out' | 'both') => page.locator(`.module-structure .segmented button[data-choice="${c}"]`)

test('L27：分层总览选中「元素族」——它往外的依赖边与到「宿主与演示」的边都亮，无关的边变淡，没有牵动 / 依赖标记', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?v=s&sel=m:providers.element')
  const own = ['providers.element->pipeline.latency', 'providers.element->pipeline.contract', 'providers.element->share.core', 'host.demo->providers.element']
  for (const id of own) await expect(page.locator(`.vue-flow__edge-dep[data-id="chip:bundle:${id}"]`)).toBeAttached()
  for (const id of own) expect(await faded(page, `chip:bundle:${id}`)).toBe(false)
  expect(await faded(page, 'bundle:host->kit')).toBe(true)
  expect(await faded(page, 'bundle:kit->pipeline')).toBe(true)
  expect(await nodeFaded(page, 'kit.kernel')).toBeGreaterThan(0)
  expect(await nodeFaded(page, 'pipeline.latency')).toBe(0)
  await expect(marks(page)).toHaveCount(0)
})

test('L27：选中状态下悬停另一个模块，画面有响应——它的一跳边画出、邻居不变淡；移开收回', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?v=s&sel=m:providers.element')
  const chip = page.locator('.vue-flow__edge-dep[data-id="chip:bundle:kit.session->pipeline.latency"]')
  await expect(chip).toHaveCount(0)
  expect(await nodeFaded(page, 'kit.session')).toBeGreaterThan(0)
  await graphNode(page, 'kit.session').hover({ force: true })
  await expect(chip).toBeAttached()
  expect(await faded(page, 'chip:bundle:kit.session->pipeline.latency')).toBe(false)
  await expect(graphNode(page, 'kit.session').locator('.dim')).toHaveCount(0)
  // 选中的一跳仍在
  expect(await faded(page, 'chip:bundle:providers.element->pipeline.latency')).toBe(false)
  await page.mouse.move(5, 500)
  await expect(chip).toHaveCount(0)
})

test('K15b：面板点「影响面」出现距离标记；换选中后标记消失、按钮回到「不看」；刷新后不保留', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?v=s&sel=m:pipeline.latency')
  await expect(choice(page, 'none')).toHaveClass(/on/)
  await expect(marks(page)).toHaveCount(0)
  await choice(page, 'in').click()
  await expect(marks(page).first()).toBeVisible()
  await expect(choice(page, 'in')).toHaveClass(/on/)
  // 刷新：查询不进 URL、不记在本地
  expect(query(page).toString()).not.toContain('impact')
  await page.reload()
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
  await expect(choice(page, 'none')).toHaveClass(/on/)
  await expect(marks(page)).toHaveCount(0)
  // 换选中
  await choice(page, 'in').click()
  await expect(marks(page).first()).toBeVisible()
  await graphNode(page, 'kit.session').click({ force: true })
  await expect.poll(() => query(page).get('sel')).toBe('m:kit.session')
  await expect(marks(page)).toHaveCount(0)
  await expect(choice(page, 'none')).toHaveClass(/on/)
})

test('K15d：「延迟决策律」的影响面查询——经具名接口（validateLatencyConfig）或只经再导出使用它的标为可能波及', async ({ page }) => {
  await openDesk(page, '/p/media-web-player?v=s&sel=m:pipeline.latency')
  await choice(page, 'in').click()
  // 分层总览按带投影（K15b③）：宿主与演示只经可截断处到达，整带可能波及；播放器 Kit 有会话内核必然波及
  const mark = (id: string) => graphNode(page, id).getByTestId('impact-mark').first()
  await expect(mark('host')).toHaveAttribute('data-possible', '')
  await expect(mark('host')).toHaveAttribute('title', /可能波及/)
  await expect(mark('kit')).not.toHaveAttribute('data-possible', '')
  // 面板清单按模块列：会话规则（经 validateLatencyConfig）、管线契约（只再导出）标「可能」，决策律以外的直接调用者不标
  const side = page.locator('.module-structure .side[data-dir="in"]')
  await expect(side).toContainText('其中可能波及')
  const row = (name: string) => side.locator('details.dist').first().locator('li', { hasText: name })
  await expect(row('会话规则').getByTestId('impact-possible')).toBeVisible()
  await expect(row('管线契约').getByTestId('impact-possible')).toBeVisible()
  await expect(row('画面冻结').getByTestId('impact-possible')).toHaveCount(0)
})
