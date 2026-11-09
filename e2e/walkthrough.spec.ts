/**
 * 负责人 2026-11-08 走查的 6 处调整（ADR-0064「第 3 版修订」）：底色分区与页头一条线（LY-2、LY-2a）、视图标签样式与常驻（LY-8、LY-9、LY-9b）、
 * 场景排布与进度（LY-11、R15a、R16a）、侧栏竖栏与筛选弹层（LY-3、LY-4d）。几何与颜色只认语义锚点（data-region、data-head、data-rail）。
 */
import { expect, test, type Page } from '@playwright/test'
import { activeTab, openDesk, openFilters, query, rail, sidebar, viewTab, views, waitSettled } from './helpers'

/** 截一行像素（y），在页面里解码成 RGB 列表（不依赖解码库；E2E 的 tsconfig 不带 DOM，页面里的代码写成字符串） */
async function pixelRow(page: Page, y: number, width: number): Promise<string[]> {
  const png = await page.screenshot({ clip: { x: 0, y, width, height: 1 } })
  return (await page.evaluate(`(async () => {
    const img = new Image()
    img.src = 'data:image/png;base64,${png.toString('base64')}'
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = 1
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, 1).data
    const out = []
    for (let i = 0; i < d.length; i += 4) out.push(d[i] + ',' + d[i + 1] + ',' + d[i + 2])
    return out
  })()`)) as string[]
}
const rgb = (page: Page, sel: string, prop: string) =>
  page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).getPropertyValue(${JSON.stringify(prop)})`) as Promise<string>
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!
const progress = (page: Page) => viewTab(page, 'sequence').locator('[data-tab-progress]')

test('LY-2、LY-2a：竖栏顶格、侧栏、画布、视图区四段页头底线同色同 y、首尾相接无缝；分隔只画 1px 线；画布正文是唯一下沉的底', async ({ page }) => {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await openDesk(page, '/p/h5p-arch-desk')
    const toggle = page.locator('[data-head="rail"]').getByRole('button', { name: '侧栏', exact: true })
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
    await waitSettled(page)
    for (const h of ['rail', 'sidebar', 'canvas', 'views']) {
      const b = await box(page, `[data-head="${h}"]`)
      expect([b.y, b.height], h).toEqual([0, 44])
    }
    // y = 43 这一行从左到右全是同一种线色：四段底线与竖线交点之间没有缝（原先 5px 白色分隔条处断开）
    const line = await pixelRow(page, 43, width)
    const colors = [...new Set(line)]
    expect(colors, `${width} 宽底线的颜色`).toHaveLength(1)
    // 分隔只画 1px：竖栏右沿、侧栏右沿、画布 | 视图区
    const divider = await box(page, '.desk > .divider')
    expect(divider.width).toBe(1)
    const r = await box(page, '[data-region="rail"]')
    expect([r.x, r.width]).toEqual([0, 44])
    const side = await box(page, '.side-area')
    expect(side.x).toBe(44)
    const canvasHead = await box(page, '[data-head="canvas"]')
    expect(canvasHead.x).toBe(side.x + side.width)
    // 底色：竖栏、侧栏、视图区、页头同为面板底，画布正文是更深一档
    const panel = await rgb(page, '[data-region="views"]', 'background-color')
    for (const sel of ['[data-region="rail"]', '.side-area', '[data-head="canvas"]', '[data-head="views"]'])
      expect(await rgb(page, sel, 'background-color'), sel).toBe(panel)
    expect(await rgb(page, '[data-region="canvas"]', 'background-color')).not.toBe(panel)
  }
  // 分隔的命中区比线宽：线外 3px 处按下也能拖宽视图区
  const d = await box(page, '.desk > .divider')
  const w0 = (await box(page, '[data-region="views"]')).width
  await page.mouse.move(d.x - 3, 400)
  await page.mouse.down()
  await page.mouse.move(d.x - 83, 400, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await box(page, '[data-region="views"]')).width).toBeGreaterThan(w0 + 40)
})

test('LY-8、LY-9：视图标签是文字 + 下划线、全部常驻没有 ×；资料标签的 × 只在悬停时出现；「+」只开资料标签', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  const bar = views(page).locator('[data-group="0"] .tabs')
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(34)
  expect(await rgb(page, '[data-region="views"] [data-group="0"] .tabs', 'border-bottom-width')).toBe('0px')
  for (const v of ['explainer', 'description', 'check'] as const) await expect(viewTab(page, v).locator('.x')).toHaveCount(0)
  // 选中态：2px 下划线压在标签栏底边，没有底色胶囊
  const on = viewTab(page, 'explainer')
  await expect(on).toHaveClass(/\bon\b/)
  const under = (await page.evaluate(
    `(() => { const s = getComputedStyle(document.querySelector('[data-view-tab="explainer"]'), '::after'); return [s.height, s.bottom] })()`,
  )) as string[]
  expect(under).toEqual(['2px', '0px'])
  expect(await rgb(page, '[data-view-tab="explainer"]', 'background-color')).toBe('rgba(0, 0, 0, 0)')
  // 「+」只有资料一节
  await views(page).getByRole('button', { name: '添加标签' }).click()
  const menu = views(page).getByRole('menu', { name: '添加标签' })
  await expect(menu.locator('.mh')).toHaveText(['资料 · 不跟随主语'])
  await expect(menu.locator('[data-add-view]')).toHaveCount(0)
  await menu.locator('[data-add-doc="issues"]').click()
  const issues = views(page).locator('.tab[data-doc-tab="issues"]')
  await expect(issues).toHaveClass(/\bon\b/)
  // × 只在悬停时出现（激活着也不出现）
  await page.locator('[data-head="views"]').hover()
  await expect(issues.locator('.x')).toHaveCSS('opacity', '0')
  await issues.hover()
  await expect(issues.locator('.x')).not.toHaveCSS('opacity', '0')
  await issues.locator('.x').click()
  await expect(issues).toHaveCount(0)
})

test('LY-9b：「核对」标签名带结论——数字等于核对标签里各卡卡头「要看」的项数之和（系统、模块），没有要看的不带数', async ({ page }) => {
  const sumOfHeads = async () => {
    const text = await views(page).locator('.panel[data-part="check"]').innerText()
    return [...text.matchAll(/⚠ (\d+) 项要看/g)].reduce((n, m) => n + Number(m[1]), 0)
  }
  for (const url of ['/p/h5p-arch-desk', '/p/h5p-arch-desk?level=state&sel=m:state.desk']) {
    await openDesk(page, url)
    await waitSettled(page)
    // 标签没激活时就有数
    const tab = viewTab(page, 'check').locator('[data-tab-count]')
    await expect(tab).toHaveText(/^⚠\d+$/)
    await viewTab(page, 'check').locator('.lbl').click()
    await expect(views(page).locator('.panel[data-part="check"] [data-card]').first()).toBeVisible()
    await expect.poll(sumOfHeads).toBeGreaterThan(0)
    expect(await tab.innerText()).toBe(`⚠${await sumOfHeads()}`)
  }
})

test('LY-11、LY-8：场景缺省排布——上组只有时序图（情境标签，名带进度），下组图解 描述 核对，约 46/54', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await waitSettled(page)
  const groups = views(page).locator('.group')
  await expect(groups).toHaveCount(2)
  await expect(groups.nth(0).locator('.tabs > .tab')).toHaveCount(1)
  await expect(groups.nth(0).locator('.tabs > .tab').first()).toHaveAttribute('data-view-tab', 'sequence')
  await expect(groups.nth(1).locator('.tabs > .tab')).toHaveCount(3)
  expect(
    await groups
      .nth(1)
      .locator('.tabs > .tab')
      .evaluateAll(ts => ts.map(t => t.getAttribute('data-view-tab'))),
  ).toEqual(['explainer', 'description', 'check'])
  await expect(activeTab(page, 1)).toHaveAttribute('data-view-tab', 'explainer')
  const top = (await groups.nth(0).boundingBox())!.height
  const bottom = (await groups.nth(1).boundingBox())!.height
  expect(top / (top + bottom)).toBeGreaterThan(0.43)
  expect(top / (top + bottom)).toBeLessThan(0.49)
  // 时序图跟随场景：名带进度，常驻没有 ×
  await expect(progress(page)).toHaveText(/^ · 0\/\d+$/)
  await expect(viewTab(page, 'sequence').locator('.x')).toHaveCount(0)
  await page.keyboard.press('ArrowRight')
  await expect(progress(page)).toHaveText(/^ · 1\/\d+$/)
})

test('R15a、R16a：场景中选中模块——主语换成它、下组跟着换；进度不变（时序图当前步骤行与画布当前路径保留）；泳道与参与的消息突出、其余变淡；选中步骤才改进度', async ({
  page,
}) => {
  await openDesk(page, '/p/h5p-arch-desk?sc=sc.open-and-play')
  await waitSettled(page)
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
  await expect(progress(page)).toHaveText(/^ · 4\//)
  const label = await progress(page).innerText()
  const step = query(page).get('step')
  expect(step).toBeTruthy()
  const seq = views(page).locator('.sequence')
  await expect(seq.locator('.msg.selected')).toHaveCount(1)
  await expect(page.locator('.edge-glow.current')).toHaveCount(1)
  // 单击时序图的泳道头（模块）：主语换成它
  const lane = seq.locator('.pin.top .lane.module').nth(1)
  const id = (await lane.getAttribute('data-lane'))!
  await lane.click()
  await expect.poll(() => query(page).get('sel')).toBe(`m:${id}`)
  await expect(page.locator('[data-head="views"] .id')).toHaveText(id)
  await expect(views(page).locator('[data-group="1"] .view-doc')).toHaveAttribute('data-subject', `module:${id}`)
  // 进度不变
  await expect(progress(page)).toHaveText(label)
  expect(query(page).get('step')).toBe(step)
  await expect(seq.locator('.msg.current')).toHaveCount(1)
  await expect(seq.locator('.msg.selected')).toHaveCount(0)
  await expect(page.locator('.edge-glow.current')).toHaveCount(1)
  // 泳道与它参与的消息突出，其余变淡
  await expect(seq.locator(`.pin.top .lane.emph[data-lane="${id}"]`)).toHaveCount(1)
  expect(await seq.locator('.msg.involved').count()).toBeGreaterThan(0)
  expect(await seq.locator('.msg.faded').count()).toBeGreaterThan(0)
  // 泳道滚到可见
  const sb = (await seq.locator('.body').boundingBox())!
  const lb = (await lane.boundingBox())!
  expect(lb.x).toBeGreaterThanOrEqual(sb.x - 1)
  expect(lb.x + lb.width).toBeLessThanOrEqual(sb.x + sb.width + 1)
  // 选中一条消息（步骤）：进度到这一步，主语是这一步
  await seq.locator('.msg.involved').first().click()
  await expect(page.locator('[data-head="views"] .tag')).toHaveText('步骤')
  await expect(seq.locator('.msg.faded')).toHaveCount(0)
  await expect(seq.locator('.msg.selected')).toHaveCount(1)
})

test('LY-3：竖栏——点当前页的图标收起侧栏，点另一个展开并切页；收起时竖栏还在；改动只在草图编辑时可用；悬停显示名称', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await expect(sidebar(page)).toBeVisible()
  const icon = (k: string) => rail(page).locator(`[data-rail="${k}"]`)
  await expect(icon('modules')).toHaveAttribute('aria-pressed', 'true')
  await expect(icon('changes')).toBeDisabled()
  await expect(icon('changes')).toHaveAttribute('title', /编辑设计的草图时可用/)
  await expect(icon('scenes')).toHaveAttribute('title', '场景')
  // 画布页头没有侧栏开关了
  await expect(page.locator('[data-head="canvas"]').getByRole('button', { name: '侧栏', exact: true })).toHaveCount(0)
  await icon('modules').click()
  await expect(sidebar(page)).toHaveCount(0)
  const r = await box(page, '[data-region="rail"]')
  expect([r.x, r.width]).toEqual([0, 44])
  expect((await box(page, '[data-head="canvas"]')).x).toBe(44)
  await icon('scenes').click()
  await expect(sidebar(page)).toBeVisible()
  await expect(sidebar(page).locator('[data-side-page-name]')).toHaveText('场景')
  await expect(icon('scenes')).toHaveAttribute('aria-pressed', 'true')
  await icon('modules').click()
  await expect(sidebar(page).locator('[data-side-page-name]')).toHaveText('模块')
  await expect(sidebar(page)).toBeVisible()
})

test('LY-4d：侧栏页内只有页名与「筛选 ▾」——模块页的树 / 排序 / 只看需复核、场景页的范围 / 类别 / 发起者都在弹层里，生效的筛选带数量', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await expect(sidebar(page).locator('[data-side-page-name]')).toHaveText('模块')
  await expect(sidebar(page).locator('[data-side-filter]')).toHaveText(/^\s*筛选\s*▾\s*$/)
  await expect(sidebar(page).locator('[data-side-mode]')).toHaveCount(0)
  let pop = await openFilters(page)
  await expect(pop.getByRole('group', { name: '树' })).toBeVisible()
  await expect(pop.getByRole('group', { name: '模块排序' })).toBeVisible()
  await pop.locator('[data-side-mode="files"]').click()
  await expect(sidebar(page).locator('[data-filter-count]')).toHaveText('1')
  await expect(sidebar(page).locator('.file-tree')).toBeVisible()
  // 弹层外单击即收起
  await page.locator('[data-head="views"]').click()
  await expect(pop).toHaveCount(0)
  // 场景页：缺省「本层相关」「主流程」两项在筛
  await rail(page).locator('[data-rail="scenes"]').click()
  await expect(sidebar(page).locator('[data-filter-count]')).toHaveText('2')
  await expect(sidebar(page).locator('.scenario-list [aria-label="范围"]')).toHaveCount(0)
  pop = await openFilters(page)
  await expect(pop.getByRole('group', { name: '范围' })).toBeVisible()
  await expect(pop.getByRole('group', { name: '类别' })).toBeVisible()
  await expect(pop.locator('select[aria-label="按发起者筛选"]')).toBeVisible()
  await pop.getByRole('group', { name: '范围' }).getByRole('button', { name: /^全部/ }).click()
  await expect(sidebar(page).locator('[data-filter-count]')).toHaveText('1')
  await expect(sidebar(page).locator('.scenario-list .item').first()).toBeVisible()
})
