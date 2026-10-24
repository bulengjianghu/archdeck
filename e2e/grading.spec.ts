/**
 * 任意层次的模块分级（ADR-0027，C-16、C-17、GV-12）：下钻 DeskState 默认主体不超过七个、单击「+N」临时展开再收起；
 * 疑似共用件一键认可写进 intent/roles.yaml，认可后它收进本层框底部的共用件架、使用者带「共用 ×N」、悬停时才画线、本层框常驻计数。
 * 认可会改真实的 model/h5p-arch-desk/intent/roles.yaml、指纹 governance/owned.json 与拦截记录 governance/ledger.jsonl，结束时原样恢复。
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { graphNode, openDesk, restoreOwned } from './helpers'

const MODEL = path.resolve(import.meta.dirname, '../model/h5p-arch-desk')
const ROLES = path.join(MODEL, 'intent/roles.yaml')
const OWNED = path.join(MODEL, 'governance/owned.json')
const LEDGER = path.join(MODEL, 'governance/ledger.jsonl')

/** 本层的主体：模块块与「+N」占位（不含边界节点、参与者、框与共用件架） */
const bodies = (page: import('@playwright/test').Page) => page.locator('.vue-flow__node-module, .vue-flow__node-more')

test('下钻 DeskState：核心大块常显、普通模块折叠为「+N」，默认主体不超过 7；单击展开、再单击收起（O8、O6）', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=state.desk')
  await expect(graphNode(page, 'more:state.desk')).toBeVisible()
  const n = await bodies(page).count()
  expect(n).toBeGreaterThan(1)
  expect(n).toBeLessThanOrEqual(7)
  await expect(page.getByTestId('level-counts')).toHaveText(/^共用件 \d+ · 折叠 \d+$/)
  const folded = Number(/折叠 (\d+)/.exec(await page.getByTestId('level-counts').innerText())![1])
  expect(folded).toBeGreaterThan(0)

  await graphNode(page, 'more:state.desk').click()
  await expect(graphNode(page, 'more:state.desk')).toContainText(`收起 ${folded} 个`)
  await expect.poll(() => bodies(page).count()).toBe(n + folded)
  // O11：本层没有共用件、展开后折叠为 0，两者都为 0 时不显示计数
  await expect(page.getByTestId('level-counts')).toHaveCount(0)
  await graphNode(page, 'more:state.desk').click()
  await expect(graphNode(page, 'more:state.desk')).toContainText(`+${folded} 个其他模块`)
  await expect.poll(() => bodies(page).count()).toBe(n)
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

    await openDesk(page, '/p/h5p-arch-desk?level=present')
    const shelf = page.locator('.vue-flow__node-shared[data-id="present.shared"]')
    await expect(shelf).toBeVisible()
    await expect(page.getByTestId('level-counts')).toContainText('共用件 1')
    const user = page.locator('.vue-flow__node-module', { has: page.locator('.shared-mark') }).first()
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
