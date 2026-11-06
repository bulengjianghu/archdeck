/**
 * 归档闭环（第二十一轮波 4 T4.1，07 §12 用例 11、12，DL-46–DL-50）：挂在 state.desk.edit 上的临时设计，假 agent 加框、认可，
 * 用直接写一份描述代替「重新生成当前版本」；结束后删掉设计、临时描述，撤销确认记录、指纹与拦截记录里的痕迹。
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { LOAD_BUDGET, openDesk, restoreOwned, sketchOn } from './helpers'

const PROJECT = path.resolve(import.meta.dirname, '../model/h5p-arch-desk')
const OWNED = path.join(PROJECT, 'governance/owned.json')
const REVIEWED = path.join(PROJECT, 'reviewed.yaml')
const dock = (page: Page) => page.getByRole('complementary', { name: '资料区' })
const dialogue = (page: Page) => dock(page).getByTestId('dialogue')
const input = (page: Page) => dialogue(page).getByRole('textbox', { name: '对话输入' })
const cards = (page: Page) => dialogue(page).getByTestId('proposal-card')
async function say(page: Page, text: string) {
  await input(page).fill(text)
  await input(page).press('Enter')
}
async function round(page: Page, text: string) {
  const n = await cards(page).count()
  await say(page, text)
  await expect(cards(page)).toHaveCount(n + 1, { timeout: LOAD_BUDGET })
  await expect(page.getByTestId('ai-editing')).toHaveCount(0)
}
const bar = (page: Page) => page.locator('.info-bar')
async function save(page: Page) {
  await bar(page).getByRole('button', { name: '保存' }).click()
  await expect(bar(page).locator('.dirty')).toHaveCount(0, { timeout: LOAD_BUDGET })
}
async function accept(page: Page) {
  await bar(page).getByRole('button', { name: '认可', exact: true }).click()
  await page.getByTestId('accept-dialog').getByTestId('accept-confirm').click()
  await expect(bar(page).locator('.chip.accepted')).toHaveText('已认可', { timeout: LOAD_BUDGET })
}
async function openChanges(page: Page) {
  if (!(await page.locator('.nav-area').isVisible())) await page.getByRole('button', { name: '导航树', exact: true }).click()
  await page.locator('.nav-tree').getByRole('tab', { name: /改动/ }).click()
  return page.getByTestId('changes-tab')
}
const archiveBtn = (page: Page) => bar(page).getByRole('button', { name: '归档', exact: true })
const MOD = (id: string, name: string) =>
  `  - { id: state.desk.edit.${id}, name: ${name}, parent: state.desk.edit, responsibility: E2E 临时, summary: E2E 临时 }\n`
const REL = (id: string) =>
  `relations:\n  - { id: rel.e2e-${id}, from: state.desk.edit.${id}, to: state.desk.edit.session, type: queries, description: 读编辑会话, purpose: E2E }\n`

test('用例 11：认可后在文件里手改草图——「归档」灰、三关提示「草图自认可后已改动」，直接请求归档也被拒', async ({ page }) => {
  test.setTimeout(120_000)
  const design = 'zz-e2e-w4-drift'
  const regenerated = path.join(PROJECT, 'modules/zz-e2e-w4-drift.yaml')
  const { restore, dir } = await sketchOn(page, design, { mount: 'state.desk.edit', extra: [regenerated], goal: '波 4 用例 11' })
  try {
    await round(page, '#archive-one 加一个核对')
    await save(page)
    await accept(page)
    const tab = await openChanges(page)
    // 代码已经改到位（直接写一份描述代替重新生成）：只剩指纹这一关会变
    fs.writeFileSync(regenerated, `modules:\n${MOD('w4-drift', '核对')}${REL('w4-drift')}`)
    await expect(tab.getByTestId('task-state')).toHaveText(['✓'], { timeout: 20_000 })
    // 手改草图文件（认可之后、在架构台之外）
    const file = path.join(dir, 'sketches/state.desk.edit.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('name: 核对', 'name: 核对（手改）'))
    await expect(tab.getByTestId('task-gate-why')).toContainText('草图自认可后已改动', { timeout: 20_000 })
    await expect(tab.locator('[data-gate="drift"]')).toHaveClass(/bad/)
    // 「归档」不亮：动作区或是灰的「归档」，或整个换成「文件已变」的横幅（会话察觉文件在外部改了）
    await expect(bar(page).getByRole('button', { name: '归档', exact: true, disabled: false })).toHaveCount(0)
    const r = await page.request.post('./write/h5p-arch-desk/archive', { data: { design } })
    expect(r.status()).toBe(400)
    expect(((await r.json()) as { error: string }).error).toContain('草图自认可后已改动')
    expect(fs.readFileSync(path.join(dir, 'design.yaml'), 'utf8')).toMatch(/status: accepted/)
  } finally {
    await restore()
  }
})

test('用例 12：改一半——不点按钮 ✓ 与待做、待做在前、归档不亮；全做完——三关全绿、归档预览「估 N · 实际 N′」、归档后已确认，对话与设计说明仍可开', async ({
  page,
}) => {
  test.setTimeout(150_000)
  const design = 'zz-e2e-w4-archive'
  const regenerated = path.join(PROJECT, 'modules/zz-e2e-w4-archive.yaml')
  const owned0 = fs.readFileSync(OWNED, 'utf8')
  const reviewed0 = fs.existsSync(REVIEWED) ? fs.readFileSync(REVIEWED, 'utf8') : null
  const { restore, dir, yaml } = await sketchOn(page, design, { mount: 'state.desk.edit', extra: [regenerated], goal: '波 4 用例 12' })
  try {
    // 先问一句、存为设计说明（归档后要还能开）
    await dialogue(page).getByRole('button', { name: '问', exact: true }).click()
    await say(page, '这一层为什么这样分？')
    await expect(dialogue(page).getByTestId('answer-card')).toBeVisible({ timeout: LOAD_BUDGET })
    await dialogue(page).getByTestId('answer-card').getByTestId('save-note').click()
    await expect(dock(page).getByTestId('note-doc')).toBeVisible({ timeout: LOAD_BUDGET })
    await dock(page).locator('.tab', { hasText: '对话' }).click()
    await dialogue(page).getByRole('button', { name: '改', exact: true }).click()
    await round(page, '#archive-two 加认可与归档')
    await save(page)
    await accept(page)
    expect(fs.existsSync(path.join(dir, 'estimate.json'))).toBe(true)
    const tab = await openChanges(page)
    await expect(tab.getByTestId('task-state')).toHaveText(['待做', '待做'])
    await expect(archiveBtn(page)).toBeDisabled()

    // 改一半：重新生成的描述只有「认可」与它的关系——不点按钮，做到的打 ✓，待做排在前
    fs.writeFileSync(regenerated, `modules:\n${MOD('w4-accept', '认可')}${REL('w4-accept')}`)
    await expect(tab.getByTestId('task-state')).toHaveText(['待做', '✓'], { timeout: 20_000 })
    await expect(tab.getByTestId('change-row').first()).toContainText('归档')
    await expect(tab.locator('[data-gate="consistent"]')).toHaveClass(/bad/, { timeout: 20_000 })
    await expect(archiveBtn(page)).toBeDisabled()

    // 全做完：三关全绿，「归档」亮
    fs.writeFileSync(regenerated, `modules:\n${MOD('w4-accept', '认可')}${MOD('w4-archive', '归档')}${REL('w4-accept')}`)
    await expect(tab.getByTestId('task-state')).toHaveText(['✓', '✓'], { timeout: 20_000 })
    await expect(tab.getByTestId('task-gates')).toContainText('三关全绿', { timeout: 30_000 })
    await expect(archiveBtn(page)).toBeEnabled()
    await archiveBtn(page).click()
    const dlg = page.getByTestId('archive-dialog')
    await expect(dlg.getByTestId('archive-gates').locator('.pass')).toHaveCount(3)
    // 同期别的用例也在改当前版本的描述：落在本设计覆盖外、估算外的单列一句（DL-49 三组）
    await expect(dlg.getByTestId('archive-gap-line')).toHaveText(/^认可时估牵动 (\d+|新) · 实际改了 \d+（其中新加 2）( · 另有同期其他改动 \d+)?$/)
    // 收尾 S2：认可以来的改动分三组——本设计覆盖的（挂载点 state.desk.edit 之下新加的两个）、估算闭包内的、同期其他改动
    const groups = dlg.getByTestId('archive-groups')
    await expect(groups.locator('li')).toHaveCount(3)
    await expect(groups.locator('[data-group="covered"]')).toContainText(/本设计覆盖的.*认可.*归档|本设计覆盖的.*归档.*认可/)
    await expect(groups.locator('[data-group="closure"]')).toContainText('估算闭包内的')
    await expect(groups.locator('[data-group="others"]')).toContainText('同期其他改动（不计入）')
    await expect(dlg.getByTestId('archive-covered')).toContainText('确认记录')
    await dlg.getByTestId('archive-confirm').click()
    await expect(dlg).toHaveCount(0, { timeout: LOAD_BUDGET })
    await expect(bar(page).locator('.chip.implemented')).toBeVisible({ timeout: 20_000 })
    expect(yaml()).toMatch(/status: implemented/)
    // 确认层：草图覆盖的模块「已确认」，来源 sketch:<设计>
    const rec = fs.readFileSync(REVIEWED, 'utf8')
    expect(rec).toMatch(new RegExp(`module: state\\.desk\\.edit\\.w4-accept[\\s\\S]*?source: sketch:${design}`))
    // 归档后的设计里：真的重新加载页面（内存里的会话没了），对话从设计目录恢复（DL-51：只问、两轮都在、「改」的一轮给一句话）与设计说明仍可开
    await page.reload()
    await openDesk(page, `/p/h5p-arch-desk/d/${design}/sketch`)
    await expect(dialogue(page)).toBeVisible()
    await expect(dialogue(page).getByTestId('mode-badge')).toHaveText('只问')
    await expect(dialogue(page).getByTestId('msg-user')).toHaveCount(2)
    await expect(dialogue(page).getByTestId('answer-card')).toHaveCount(1)
    await expect(dialogue(page).getByTestId('restored-edit')).toContainText('改动（已随设计保存）')
    // 设计说明：与设计面板那一行同一个意图（desk.notes.open）
    const note = fs.readdirSync(path.join(dir, 'notes'))[0]
    await page.evaluate(f => (globalThis as unknown as { __desk: { notes: { open(f: string): void } } }).__desk.notes.open(f), note)
    await expect(dock(page).getByTestId('note-doc')).toBeVisible()
  } finally {
    // 文件先同步还原（测试超时被中断时，等页面的那几步可能来不及跑）
    if (reviewed0 === null) fs.rmSync(REVIEWED, { force: true })
    else fs.writeFileSync(REVIEWED, reviewed0)
    restoreOwned(OWNED, owned0, ['reviewed.yaml'])
    await restore()
  }
})
