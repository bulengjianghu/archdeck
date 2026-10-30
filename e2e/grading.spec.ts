/**
 * 任意层次的模块分级（ADR-0027，C-16、C-17、GV-12）：下钻 DeskState 默认主体不超过七个、单击「+N」临时展开再收起；
 * 疑似共用件一键认可写进 intent/roles.yaml，认可后它收进本层框底部的共用件架、使用者带「共用 ×N」、悬停时才画线、本层框常驻计数。
 * 认可会改真实的 model/h5p-arch-desk/intent/roles.yaml、指纹 governance/owned.json 与拦截记录 governance/ledger.jsonl，结束时原样恢复。
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { graphNode, openDesk, restoreOwned, collapseDisplay } from './helpers'

const MODEL = path.resolve(import.meta.dirname, '../model/h5p-arch-desk')
const ROLES = path.join(MODEL, 'intent/roles.yaml')
const OWNED = path.join(MODEL, 'governance/owned.json')
const LEDGER = path.join(MODEL, 'governance/ledger.jsonl')

test('下钻呈现层：「区块」层超七，核心常显、普通成员折叠为「+N」；不超七的多成员层全显；单击展开、再单击收起（O2a、O6，ADR-0052）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=present')
  // 先收起右上角的图例，免得它盖住带底的「+N」
  await collapseDisplay(page)
  const chip = graphNode(page, 'more:s:present/block')
  await expect(chip).toBeVisible()
  const cores = page.locator('.vue-flow__node-core')
  const n = await cores.count()
  // 「页面」层两个成员都露出（不超七全显）
  for (const id of ['present.project-list', 'present.desk-view']) await expect(graphNode(page, id)).toBeVisible()
  const folded = Number(/\+(\d+) 个其他模块/.exec(await chip.innerText())![1])
  expect(folded).toBeGreaterThan(0)
  await chip.click()
  await expect(chip).toContainText(`收起 ${folded} 个`)
  await expect.poll(() => cores.count()).toBe(n + folded)
  await chip.click()
  await expect(chip).toContainText(`+${folded} 个其他模块`)
  await expect.poll(() => cores.count()).toBe(n)
})

test('疑似共用件一键认可写进 intent/roles.yaml；认可后收进共用件架，使用者带「共用 ×N」，悬停才画线（U11、O9–O11）', async ({ page }) => {
  const roles0 = fs.existsSync(ROLES) ? fs.readFileSync(ROLES, 'utf8') : null
  const owned0 = fs.readFileSync(OWNED, 'utf8')
  const ledger0 = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8') : null
  try {
    await openDesk(page, '/p/h5p-arch-desk')
    const list = page.getByTestId('shared-suggestions')
    const item = list.locator('[data-module="present.shared"]')
    await expect(item).toContainText('入度广')
    await expect(item).toContainText('不在任何场景路径上')
    await item.getByRole('button', { name: '认可为共用件' }).click()
    await expect.poll(() => fs.readFileSync(ROLES, 'utf8')).toMatch(/^ {2}present\.shared: shared$/m)
    expect(fs.readFileSync(LEDGER, 'utf8')).toContain('"tool":"roles"')
    // 文件变化推送后重新加载：建议消失
    await expect(list.locator('[data-module="present.shared"]')).toHaveCount(0)

    // ADR-0052：呈现层声明了分层，呈现共用件自成「共用件」层（单成员层的带即成员）；在根层看它在呈现层带底的共用件架上
    await openDesk(page, '/p/h5p-arch-desk')
    const shelf = page.locator('.vue-flow__node-shared[data-id="present.shared"]')
    await expect(shelf).toBeVisible()
    await expect(graphNode(page, 'present').getByTestId('band-counts')).toContainText('共用件 1')
    const user = page.locator('.vue-flow__node-core', { has: page.locator('.shared-mark') }).first()
    await expect(user.locator('.shared-mark')).toHaveText(/^共用 ×\d+$/)
    // 共用件的边默认不画，悬停共用件时画出它与使用者之间的线
    const shelfEdges = page.locator('.vue-flow__edge[data-id*="present.shared"]')
    await expect(shelfEdges).toHaveCount(0)
    await shelf.hover()
    await expect.poll(() => shelfEdges.count()).toBeGreaterThan(0)
  } finally {
    if (roles0 === null) fs.rmSync(ROLES, { force: true })
    else fs.writeFileSync(ROLES, roles0)
    restoreOwned(OWNED, owned0, ['intent/roles.yaml'])
    if (ledger0 === null) fs.rmSync(LEDGER, { force: true })
    else fs.writeFileSync(LEDGER, ledger0)
  }
})
