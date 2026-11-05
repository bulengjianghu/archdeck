/**
 * 认可与任务单（第二十一轮波 3；验收草案 07 §12 用例 9、10，TK-1–TK-4、DL-32–DL-38）：
 * 认可前总览 → 已认可（草图锁定：拖框、对话的「改」都被拒并提示「回到起草」）→ 改动页签切任务模式（状态列、撤回灰、复制给 agent、导出 JSON，
 * 当前版本重新生成后自动重算）→ 回到起草（任务单标「认可已撤回」）→ 改一处再认可（指纹更新、任务单重算）；放弃后设计不在卡片上、草图与对话仍可开。
 * agent 是假 agent 替身；每个用例在真实的 model/h5p-arch-desk/designs/ 下建一个临时设计（挂在 DeskState 上），结束后删掉并撤销指纹与拦截记录里的痕迹。
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { graphNode, openDesk, openSketchPanel, restoreOwned } from './helpers'

const PROJECT = path.resolve(import.meta.dirname, '../model/h5p-arch-desk')
const OWNED = path.join(PROJECT, 'governance/owned.json')
const LEDGER = path.join(PROJECT, 'governance/ledger.jsonl')

async function sketchOn(page: Page, design: string, extra: string[] = [], mount = 'state.desk.edit') {
  const dir = path.join(PROJECT, 'designs', design)
  const owned0 = fs.readFileSync(OWNED, 'utf8')
  const restore = async () => {
    const stop = page.getByTestId('dialogue-stop')
    if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => {})
    await new Promise(r => setTimeout(r, 300))
    fs.rmSync(dir, { recursive: true, force: true })
    // 停止前子进程可能已说完：服务端随后才追加转录，会把设计目录又建出来——等一下再删一次
    await new Promise(r => setTimeout(r, 1500))
    fs.rmSync(dir, { recursive: true, force: true })
    for (const f of extra) fs.rmSync(f, { force: true })
    restoreOwned(OWNED, owned0, [`designs/${design}/`])
    if (fs.existsSync(LEDGER)) {
      const lines = fs.readFileSync(LEDGER, 'utf8').split('\n')
      const rest = lines.filter(l => !l.includes(`"design":"${design}"`) && !l.includes(`"file":"designs/${design}/`))
      if (rest.length !== lines.length) fs.writeFileSync(LEDGER, rest.join('\n'))
    }
  }
  fs.rmSync(dir, { recursive: true, force: true })
  for (const f of extra) fs.rmSync(f, { force: true })
  const r = await page.request.post(`./write/h5p-arch-desk/designs`, { data: { id: design, name: `E2E ${design}`, goal: '波 3', mount } })
  expect(r.ok()).toBe(true)
  await openDesk(page, `/p/h5p-arch-desk/d/${design}/sketch`)
  await expect(page.locator('.sketch-canvas')).toBeVisible()
  return { restore, yaml: () => fs.readFileSync(path.join(dir, 'design.yaml'), 'utf8') }
}

const dock = (page: Page) => page.getByRole('complementary', { name: '资料区' })
const dialogue = (page: Page) => dock(page).getByTestId('dialogue')
const input = (page: Page) => dialogue(page).getByRole('textbox', { name: '对话输入' })
const cards = (page: Page) => dialogue(page).getByTestId('proposal-card')
async function round(page: Page, text: string) {
  const n = await cards(page).count()
  await input(page).fill(text)
  await input(page).press('Enter')
  // 一轮的等待按 agent 的超时预算（playwright.config 的 ARCH_AGENT_TIMEOUT_MS = 20s）留余量：机器负载高时服务端读描述就要好几秒
  await expect(cards(page)).toHaveCount(n + 1, { timeout: 25_000 })
  await expect(page.getByTestId('ai-editing')).toHaveCount(0)
}
const bar = (page: Page) => page.locator('.info-bar')
async function save(page: Page) {
  await bar(page).getByRole('button', { name: '保存' }).click()
  await expect(bar(page).locator('.dirty')).toHaveCount(0)
}
async function accept(page: Page) {
  await bar(page).getByRole('button', { name: '认可', exact: true }).click()
  const dlg = page.getByTestId('accept-dialog')
  await expect(dlg).toBeVisible()
  return dlg
}
async function openChanges(page: Page) {
  if (!(await page.locator('.nav-area').isVisible())) await page.getByRole('button', { name: '导航树', exact: true }).click()
  await page.locator('.nav-tree').getByRole('tab', { name: /改动/ }).click()
  return page.getByTestId('changes-tab')
}
const shown = (page: Page) =>
  page.evaluate(() => {
    const sc = (
      globalThis as unknown as {
        __desk: { edit: { scene: { value: { nodes: { id: string; position: { x: number; y: number }; data: { kind: string } }[] } } } }
      }
    ).__desk.edit.scene.value
    return Object.fromEntries(sc.nodes.filter(n => n.data.kind === 'module').map(n => [n.id, n.position]))
  })

test('用例 9：认可——总览列出全设计改动与影响面，确认后「已认可」、草图锁定；页签切任务模式（状态列、撤回灰、复制与导出）；拖框与对话的「改」被拒并提示「回到起草」；当前版本重新生成后自动重算', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const regenerated = path.join(PROJECT, 'modules/zz-e2e-w3-derived.yaml')
  const { restore, yaml } = await sketchOn(page, 'zz-e2e-w3-accept', [regenerated])
  try {
    await round(page, '#approval-add 加一个认可')
    // 未保存时「认可」被拒并说明
    await bar(page).getByRole('button', { name: '认可', exact: true }).click()
    await expect(page.getByTestId('accept-dialog')).toHaveCount(0)
    await expect(bar(page).getByRole('status')).toContainText('先保存')
    await save(page)
    // 认可 ▾ 的下拉保留「交给 AI 展开一轮」
    await bar(page).getByRole('button', { name: '更多认可动作' }).click()
    await expect(page.getByRole('menuitem', { name: /交给 AI 展开一轮/ })).toBeVisible()
    await page.keyboard.press('Escape')
    // 认可前总览：带号的改动、影响面（按当前描述估）
    const dlg = await accept(page)
    await expect(dlg.getByTestId('accept-item')).toHaveCount(1)
    await expect(dlg.getByTestId('accept-item')).toContainText(/#\d+ 新增 认可/)
    await expect(dlg.getByTestId('accept-impact')).toContainText('按当前描述估')
    await dlg.getByTestId('accept-confirm').click()
    await expect(page.getByTestId('accept-dialog')).toHaveCount(0)
    await expect(bar(page).locator('.chip.accepted')).toHaveText('已认可')
    await expect(page.getByTestId('design-locked')).toContainText('回到起草')
    await expect(bar(page).getByRole('button', { name: '回到起草' })).toBeVisible()
    await expect(bar(page).getByRole('button', { name: '保存' })).toHaveCount(0)
    expect(yaml()).toMatch(/status: accepted/)
    expect(yaml()).toMatch(/approval:[\s\S]*sketches\/state\.desk\.edit\.yaml: [0-9a-f]{40}/)

    // 任务模式：号不变、多状态列、撤回变灰；复制与导出
    const tab = await openChanges(page)
    await expect(tab.getByTestId('task-head')).toContainText('有效')
    await expect(tab.getByTestId('change-row')).toHaveCount(1)
    await expect(tab.getByTestId('task-state')).toHaveText(['待做'])
    for (const b of await tab.getByTestId('withdraw-item').all()) await expect(b).toBeDisabled()
    await expect(tab.getByTestId('tab-withdraw-round')).toBeDisabled()
    await tab.getByTestId('copy-tasks').click()
    await expect(tab.getByTestId('copy-tasks')).toHaveText('已复制')
    const md = await page.evaluate(() =>
      (globalThis as unknown as { navigator: { clipboard: { readText(): Promise<string> } } }).navigator.clipboard.readText(),
    )
    expect(md).toContain('# 任务单：设计「E2E zz-e2e-w3-accept」')
    expect(md).toMatch(/## #\d+ 待做 · 新增/)
    const [download] = await Promise.all([page.waitForEvent('download'), tab.getByTestId('export-tasks').click()])
    expect(download.suggestedFilename()).toBe('tasks-zz-e2e-w3-accept.json')
    const json = JSON.parse(fs.readFileSync((await download.path())!, 'utf8')) as { state: string; rows: { state: string }[] }
    expect(json).toMatchObject({ state: 'active', rows: [{ state: 'todo' }] })

    // 拖框被拒：位置不变，信息条提示「回到起草」
    await page.getByRole('button', { name: '导航树', exact: true }).click()
    const before = (await shown(page))['state.desk.edit.session']
    const b = (await graphNode(page, 'state.desk.edit.session').locator('.name').boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 30, { steps: 8 })
    await page.mouse.up()
    expect((await shown(page))['state.desk.edit.session']).toEqual(before)
    await expect(bar(page).locator('.dirty')).toHaveCount(0)
    // 对话的「改」被拒：只问，「改」灰，提示「回到起草」
    await expect(dialogue(page).getByTestId('mode-badge')).toHaveText('只问')
    await expect(dialogue(page).getByTestId('mode-edit')).toBeDisabled()
    await expect(dialogue(page).getByTestId('dialogue-lock')).toContainText('回到起草')

    // 当前版本重新生成（这里直接写一份描述代替）：不点任何按钮，做到的项打 ✓
    fs.writeFileSync(
      regenerated,
      'modules:\n  - { id: state.desk.edit.approval, name: 认可, parent: state.desk.edit, responsibility: E2E 临时, summary: E2E 临时 }\nrelations:\n  - { id: rel.e2e-w3-approval, from: state.desk.edit.approval, to: state.desk.edit.session, type: queries, description: 读编辑会话, purpose: E2E }\n',
    )
    await openChanges(page)
    await expect(tab.getByTestId('task-state')).toHaveText(['✓'], { timeout: 20_000 })
    await expect(tab.getByTestId('task-counts')).toContainText('✓ 1')
  } finally {
    await restore()
  }
})

test('用例 10：回到起草——回「起草中」、任务单标「认可已撤回」；改一处再认可，指纹更新、任务单重算', async ({ page }) => {
  test.setTimeout(120_000)
  const { restore, yaml } = await sketchOn(page, 'zz-e2e-w3-withdraw')
  try {
    await round(page, '#approval-add 加一个认可')
    await save(page)
    await (await accept(page)).getByTestId('accept-confirm').click()
    await expect(bar(page).locator('.chip.accepted')).toHaveText('已认可')
    const first = /sketches\/state\.desk\.edit\.yaml: ([0-9a-f]{40})/.exec(yaml())![1]
    // 回到起草：二次确认
    await bar(page).getByRole('button', { name: '回到起草' }).click()
    await page.getByRole('dialog', { name: '回到起草？' }).getByRole('button', { name: '回到起草' }).click()
    await expect(bar(page).locator('.chip.draft')).toHaveText('起草中')
    await expect(page.getByTestId('design-locked')).toHaveCount(0)
    expect(yaml()).toMatch(/status: draft/)
    expect(yaml()).toMatch(/withdrawnAt:/)
    const tab = await openChanges(page)
    await expect(tab.getByTestId('task-withdrawn')).toContainText('认可已撤回')
    await expect(tab.getByTestId('task-state')).toHaveCount(0)
    await expect(dialogue(page).getByTestId('mode-badge')).toHaveText('可改')
    // 改一处（AI 再一轮）、保存、再认可
    await round(page, '#approval-rename save 改名')
    await save(page)
    await expect(tab.getByTestId('change-row')).toHaveCount(2)
    await (await accept(page)).getByTestId('accept-confirm').click()
    await expect(bar(page).locator('.chip.accepted')).toHaveText('已认可')
    const second = /sketches\/state\.desk\.edit\.yaml: ([0-9a-f]{40})/.exec(yaml())![1]
    expect(second).not.toBe(first)
    expect(yaml()).not.toMatch(/withdrawnAt:/)
    await openChanges(page)
    await expect(tab.getByTestId('task-head')).toContainText('有效')
    await expect(tab.getByTestId('task-state')).toHaveCount(2)
  } finally {
    await restore()
  }
})

test('放弃：设计面板「放弃设计」二次确认后为「已放弃」、只看；项目卡片不再列出，草图与对话仍可开', async ({ page }) => {
  const { restore, yaml } = await sketchOn(page, 'zz-e2e-w3-abandon')
  try {
    await openSketchPanel(page)
    await page.getByTestId('abandon-design').click()
    await page
      .getByRole('dialog', { name: /放弃设计/ })
      .getByRole('button', { name: '放弃设计' })
      .click()
    await expect(bar(page).locator('.chip.abandoned')).toHaveText('已放弃')
    await expect(page.getByTestId('design-locked')).toHaveText('只看')
    expect(yaml()).toMatch(/status: abandoned/)
    await expect(bar(page).getByRole('button', { name: '认可', exact: true })).toHaveCount(0)
    // 项目卡片不再列出
    await page.goto('./')
    const card = page.locator('ul.grid > li', { has: page.locator('code.id', { hasText: /^h5p-arch-desk$/ }) })
    await expect(card).toBeVisible()
    await expect(card).not.toContainText('E2E zz-e2e-w3-abandon')
    // 草图与对话仍可开
    await openDesk(page, `/p/h5p-arch-desk/d/zz-e2e-w3-abandon/sketch`)
    await expect(page.locator('.sketch-canvas')).toBeVisible()
    await expect(dialogue(page)).toBeVisible()
    await expect(dialogue(page).getByTestId('mode-badge')).toHaveText('只问')
  } finally {
    await restore()
  }
})
