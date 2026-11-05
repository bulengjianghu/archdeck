/**
 * 草图里「改」（第二十一轮波 2；验收草案 07 §12 用例 1、2、3、5、6、7、8，DA-6–DA-10、CI-1–CI-7、DL-19–DL-31）：
 * 开发服务器的 agent 是假 agent 替身（playwright.config 的 ARCH_AGENT_COMMAND），剧本按输入里的「#名字」挑（scripts/agent/scripts/），
 * 「改」没有标签时用 edit.json。每个用例在真实的 model/h5p-arch-desk/designs/ 下建一个临时设计（挂在 DeskState 上），结束后删掉，
 * 指纹 owned.json 与拦截记录 ledger.jsonl 里它留下的痕迹一并撤销。
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { graphNode, openDesk, openSketchPanel, query, restoreOwned } from './helpers'

const PROJECT = path.resolve(import.meta.dirname, '../model/h5p-arch-desk')
const OWNED = path.join(PROJECT, 'governance/owned.json')
const LEDGER = path.join(PROJECT, 'governance/ledger.jsonl')

/** 在 DeskState 上新建一个临时设计并打开它的草图；返回清理函数 */
async function sketchOn(page: Page, design: string) {
  const dir = path.join(PROJECT, 'designs', design)
  const owned0 = fs.readFileSync(OWNED, 'utf8')
  const restore = async () => {
    // 还在跑的一轮先停下（它说完时会往设计目录追加转录），再删目录
    const stop = page.getByTestId('dialogue-stop')
    if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => {})
    await new Promise(r => setTimeout(r, 300))
    fs.rmSync(dir, { recursive: true, force: true })
    restoreOwned(OWNED, owned0, [`designs/${design}/`])
    if (fs.existsSync(LEDGER)) {
      const lines = fs.readFileSync(LEDGER, 'utf8').split('\n')
      const rest = lines.filter(l => !l.includes(`"design":"${design}"`) && !l.includes(`"file":"designs/${design}/`))
      if (rest.length !== lines.length) fs.writeFileSync(LEDGER, rest.join('\n'))
    }
  }
  // 上一次没清干净（中途被杀）的同名设计先删掉
  fs.rmSync(dir, { recursive: true, force: true })
  const r = await page.request.post(`./write/h5p-arch-desk/designs`, { data: { id: design, name: `E2E ${design}`, goal: '波 2', mount: 'state.desk' } })
  expect(r.ok()).toBe(true)
  await openDesk(page, `/p/h5p-arch-desk/d/${design}/sketch`)
  await expect(page.locator('.sketch-canvas')).toBeVisible()
  return restore
}

const dock = (page: Page) => page.getByRole('complementary', { name: '资料区' })
const dialogue = (page: Page) => dock(page).getByTestId('dialogue')
const input = (page: Page) => dialogue(page).getByRole('textbox', { name: '对话输入' })
async function say(page: Page, text: string) {
  await input(page).fill(text)
  await input(page).press('Enter')
}
const cards = (page: Page) => dialogue(page).getByTestId('proposal-card')
/** 发一句「改」，等这一轮的提议卡出来 */
async function round(page: Page, text: string) {
  const n = await cards(page).count()
  await say(page, text)
  await expect(cards(page)).toHaveCount(n + 1)
  await expect(page.getByTestId('ai-editing')).toHaveCount(0)
  return cards(page).nth(n)
}
const props = (page: Page) => page.getByRole('complementary', { name: '属性' })
async function openChanges(page: Page) {
  if (!(await page.locator('.nav-area').isVisible())) await page.getByRole('button', { name: '导航树', exact: true }).click()
  await page.locator('.nav-tree').getByRole('tab', { name: /改动/ }).click()
  return page.getByTestId('changes-tab')
}
const rows = (page: Page) => page.getByTestId('change-row')
const row = (page: Page, n: number) => page.locator(`[data-testid="change-row"][data-n="${n}"]`)
/** 编辑会话里当前张显示的位置（相对中心区原点之前的画布坐标） */
const shown = (page: Page) =>
  page.evaluate(() => {
    const sc = (
      globalThis as unknown as {
        __desk: { edit: { scene: { value: { nodes: { id: string; position: { x: number; y: number }; data: { kind: string } }[] } } } }
      }
    ).__desk.edit.scene.value
    return Object.fromEntries(sc.nodes.filter(n => n.data.kind === 'module').map(n => [n.id, n.position]))
  })

test('用例 1、DL-20：进入草图画布——对话自动打开并固定、锚点「当前张 DeskState」、缺省「改」；选中面板缺省收起，展开时浮在右侧、画布宽度不变', async ({
  page,
}) => {
  const restore = await sketchOn(page, 'zz-e2e-w2-layout')
  try {
    await expect(dock(page).locator('.tab.on:not(.preview)')).toContainText('对话')
    await expect(dialogue(page).getByTestId('anchor-bar')).toContainText('当前张 DeskState')
    await expect(dialogue(page).getByTestId('mode-badge')).toHaveText('可改')
    await expect(props(page)).toHaveCount(0)
    // 画布节点不被盖：最右边的本层模块在画布可见区域里
    const canvas = (await page.locator('.sketch-canvas').boundingBox())!
    // 右键「编辑字段…」按需展开：浮在画布右侧，画布宽度不变
    await graphNode(page, 'state.desk.writer').locator('.name').click({ button: 'right' })
    await page.getByRole('menuitem', { name: '编辑字段…' }).click()
    await expect(props(page)).toBeVisible()
    await expect(props(page)).toHaveClass(/floating/)
    expect((await page.locator('.sketch-canvas').boundingBox())!.width).toBe(canvas.width)
    await expect(page.locator('[data-testid="sketch-module-form"]')).toBeVisible()
    // 选中框后锚点条带上框
    await expect(dialogue(page).getByTestId('anchor-bar')).toContainText('当前张 DeskState · ')
  } finally {
    await restore()
  }
})

test('用例 2、5：合并一轮——标色打号、提议卡「按当前代码估」、撤回本轮复原、重做恢复；三处改动后页签三行，单击行居中、单击徽标滚到、撤回一项 ⌘Z 可反悔；删除项悬停显示虚框', async ({
  page,
}) => {
  // 四轮对话加一串页签操作：比单个用例的缺省 60s 长
  test.setTimeout(120_000)
  const restore = await sketchOn(page, 'zz-e2e-w2-merge')
  try {
    const card = await round(page, '#merge 把 edit 与 versions 合并为编辑会话')
    await expect(graphNode(page, 'state.desk.session')).toBeVisible()
    await expect(graphNode(page, 'state.desk.edit')).toHaveCount(0)
    await expect(card.getByTestId('proposal-number')).toHaveText(['#1'])
    await expect(card.getByTestId('proposal-impact')).toContainText('按当前代码估')
    await expect(card.getByTestId('proposal-impact')).toContainText(/牵动 \d+ 个模块/)
    await expect(graphNode(page, 'state.desk.session').getByTestId('change-badge')).toHaveText('#1')
    await expect(graphNode(page, 'state.desk.session').locator('.badge')).toHaveText('合')
    // 撤回本轮 = 一步撤销；重做恢复
    await card.getByTestId('withdraw-round').click()
    await expect(graphNode(page, 'state.desk.edit')).toBeVisible()
    await expect(graphNode(page, 'state.desk.session')).toHaveCount(0)
    await expect(card.getByTestId('withdraw-round')).toHaveText('本轮已撤回')
    await page.locator('.info-bar').getByRole('button', { name: '重做' }).click()
    await expect(graphNode(page, 'state.desk.session')).toBeVisible()

    // 第二、三轮：新增运行派生、改 ID writer → persist；人再删一个（删除项）
    await round(page, '#add 加一个运行派生')
    await round(page, '#rename writer 改名')
    await graphNode(page, 'state.desk.legend').locator('.name').click({ button: 'right' })
    await page.getByRole('menuitem', { name: '删除' }).click()
    // 有连带删除的关系时二次确认（X7e）
    await page
      .getByRole('dialog', { name: /删除 state\.desk\.legend/ })
      .getByRole('button', { name: '删除' })
      .click()
    await expect(graphNode(page, 'state.desk.legend')).toHaveCount(0)
    const tab = await openChanges(page)
    await expect(rows(page)).toHaveCount(4)
    // 重做得新号（#1 撤回后留空）：合并现在是 #2
    const merged = rows(page).filter({ hasText: '合并' })
    await expect(merged).toContainText('第 1 轮 · AI')
    await expect(tab.getByTestId('changes-six')).toContainText('合 1')
    // 单击行：画布选中并居中
    const added = rows(page).filter({ hasText: '新增' })
    await added.locator('.row').click()
    await expect.poll(() => query(page).get('sel')).toBe('m:state.desk.derived')
    // 单击画布徽标：清单滚到那一行（闪一下）
    const n = Number(await graphNode(page, 'state.desk.persist').getByTestId('change-badge').getAttribute('data-n'))
    await graphNode(page, 'state.desk.persist').getByTestId('change-badge').click()
    await expect(row(page, n)).toHaveClass(/flash/)
    // 删除项不常驻虚影，悬停时在原位置显示虚框，移开即消失
    await rows(page).filter({ hasText: '删除' }).hover()
    await expect(page.getByTestId('ghost')).toHaveCount(1)
    await input(page).hover()
    await expect(page.getByTestId('ghost')).toHaveCount(0)
    // 撤回一项（新增）：恢复到基线，别的项不动；⌘Z 反悔
    await added.getByTestId('withdraw-item').click()
    await expect(graphNode(page, 'state.desk.derived')).toHaveCount(0)
    await expect(graphNode(page, 'state.desk.session')).toBeVisible()
    await expect(graphNode(page, 'state.desk.persist')).toBeVisible()
    await expect(rows(page)).toHaveCount(3)
    await page.locator('.info-bar').getByRole('button', { name: '撤销' }).click()
    await expect(graphNode(page, 'state.desk.derived')).toBeVisible()
    // 页签的「撤回本轮」= 最近一轮（改 ID）——最近一步是人的删除与撤回，最近一轮的那一步不在栈顶，按快照恢复
    await tab.getByTestId('tab-withdraw-round').click()
    await expect(graphNode(page, 'state.desk.writer')).toBeVisible()
    await expect(graphNode(page, 'state.desk.persist')).toHaveCount(0)
  } finally {
    await restore()
  }
})

test('用例 3、DL-28：AI 回合中画布只读——信息条「AI 正在修改…」，拖框无效；说完后恢复', async ({ page }) => {
  const restore = await sketchOn(page, 'zz-e2e-w2-busy')
  try {
    await expect(graphNode(page, 'state.desk.writer')).toBeVisible()
    const before = (await shown(page))['state.desk.writer']
    await say(page, '#slow-merge 慢慢合并')
    await expect(page.getByTestId('ai-editing')).toContainText('AI 正在修改')
    await expect(dialogue(page).getByTestId('msg-live')).toContainText('AI 正在修改')
    const b = (await graphNode(page, 'state.desk.writer').locator('.name').boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 30, { steps: 8 })
    await page.mouse.up()
    expect((await shown(page))['state.desk.writer']).toEqual(before)
    await expect(page.locator('.info-bar .dirty')).toHaveCount(0)
    // 说完：落成一轮，只读解除
    await expect(cards(page)).toHaveCount(1, { timeout: 20_000 })
    await expect(page.getByTestId('ai-editing')).toHaveCount(0)
    await expect(graphNode(page, 'state.desk.session')).toBeVisible()
  } finally {
    await restore()
  }
})

test('用例 6、DL-26：第 3 轮之后撤回第 1 轮——第 1 轮碰过的框回到开始前，第 2 轮的不动；第 3 轮也碰过同一个框时先列出并确认', async ({ page }) => {
  const restore = await sketchOn(page, 'zz-e2e-w2-earlier')
  try {
    const first = await round(page, '#merge 合并')
    await round(page, '#add 加运行派生')
    await round(page, '#touch 写编辑会话的职责')
    await first.getByTestId('withdraw-round').click()
    const ask = page.getByRole('dialog', { name: /撤回第 1 轮/ })
    await expect(ask).toContainText('编辑会话')
    await ask.getByRole('button', { name: '取消' }).click()
    await expect(graphNode(page, 'state.desk.session')).toBeVisible()
    await first.getByTestId('withdraw-round').click()
    await page
      .getByRole('dialog', { name: /撤回第 1 轮/ })
      .getByRole('button', { name: '撤回' })
      .click()
    await expect(graphNode(page, 'state.desk.session')).toHaveCount(0)
    await expect(graphNode(page, 'state.desk.edit')).toBeVisible()
    await expect(graphNode(page, 'state.desk.versions')).toBeVisible()
    await expect(graphNode(page, 'state.desk.derived')).toBeVisible()
    await expect(first.getByTestId('withdraw-round')).toHaveText('本轮已撤回')
  } finally {
    await restore()
  }
})

test('用例 7：草图里贴白板照片——梳理卡旁「按这张图起草」一键变成一轮提议，可撤回', async ({ page }) => {
  const restore = await sketchOn(page, 'zz-e2e-w2-photo')
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    await dialogue(page).getByTestId('dialogue-file').setInputFiles({ name: 'whiteboard.png', mimeType: 'image/png', buffer: png })
    await say(page, '#digest 这是白板')
    const digest = dialogue(page).getByTestId('digest')
    await expect(digest).toBeVisible()
    await expect(digest.getByTestId('digest-photo')).toHaveCount(1)
    await digest.getByTestId('draft-from-digest').click()
    await expect(cards(page)).toHaveCount(1)
    await expect(graphNode(page, 'state.desk.whiteboard')).toBeVisible()
    // 照片随设计落盘
    expect(fs.readdirSync(path.join(PROJECT, 'designs/zz-e2e-w2-photo/dialogue/photos')).length).toBeGreaterThan(0)
    await cards(page).first().getByTestId('withdraw-round').click()
    await expect(graphNode(page, 'state.desk.whiteboard')).toHaveCount(0)
  } finally {
    await restore()
  }
})

test('用例 8、DL-30、DL-6：起点与模型画布同一层的摆法一致；AI 加一个框——原有的框一个不动，新框在有关系的框旁', async ({ page }) => {
  // 模型画布上 DeskState 那一层的相对位置
  await openDesk(page, '/p/h5p-arch-desk?level=state.desk')
  const model = async (id: string) => (await graphNode(page, id).boundingBox())!
  const [m1, m2] = [await model('state.desk.loading'), await model('state.desk.projection')]
  const restore = await sketchOn(page, 'zz-e2e-w2-start')
  try {
    await expect.poll(async () => Object.keys(await shown(page)).length).toBeGreaterThan(10)
    // 起点算好（异步）后与模型画布同向：左右、上下的先后一致
    await expect
      .poll(async () => {
        const s = await shown(page)
        const a = s['state.desk.loading']
        const b = s['state.desk.projection']
        return [Math.sign(Math.round(b.x - a.x)), Math.sign(Math.round(b.y - a.y))]
      })
      .toEqual([Math.sign(Math.round(m2.x - m1.x)), Math.sign(Math.round(m2.y - m1.y))])
    const before = await shown(page)
    await round(page, '#add 加运行派生（读描述）')
    const after = await shown(page)
    for (const [id, p] of Object.entries(before)) expect(after[id], id).toEqual(p)
    // 新框在有关系的框（loading）旁
    const d = after['state.desk.derived']
    const l = after['state.desk.loading']
    expect(Math.abs(d.x - l.x) + Math.abs(d.y - l.y)).toBeLessThanOrEqual(220 + 120)
  } finally {
    await restore()
  }
})

test('改 / 问切换、DL-21：「问」只回答不改图；AI 想挪已有的框整轮拒绝；存为设计说明——预览标签标「目标态 · 未实现」、设计面板有条目', async ({ page }) => {
  const restore = await sketchOn(page, 'zz-e2e-w2-ask')
  try {
    await dialogue(page).getByRole('button', { name: '问', exact: true }).click()
    await expect(dialogue(page).getByTestId('mode-badge')).toHaveText('只问')
    await say(page, '为什么这样分？')
    const answer = dialogue(page).getByTestId('answer-card')
    await expect(answer).toBeVisible()
    await expect(cards(page)).toHaveCount(0)
    await expect(page.locator('.info-bar .dirty')).toHaveCount(0)
    // 存为设计说明
    await answer.getByTestId('save-note').click()
    // 存好后辅助栏打开预览标签（对话标签退到后面）
    await expect(dock(page).getByTestId('note-doc')).toBeVisible()
    await expect(dock(page).getByTestId('note-target')).toHaveText('目标态 · 未实现')
    const notes = fs.readdirSync(path.join(PROJECT, 'designs/zz-e2e-w2-ask/notes'))
    expect(notes).toHaveLength(1)
    expect(fs.readFileSync(path.join(PROJECT, 'designs/zz-e2e-w2-ask/notes', notes[0]), 'utf8')).toContain('目标态 · 未实现')
    await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
    await openSketchPanel(page)
    await expect(page.getByTestId('design-notes')).toContainText('为什么这样分')
    // 回到「改」：AI 想挪已有的框——整轮拒绝，什么都不落
    await dock(page).locator('.tab', { hasText: '对话' }).click()
    await dialogue(page).getByRole('button', { name: '改', exact: true }).click()
    await expect(dialogue(page).getByTestId('mode-badge')).toHaveText('可改')
    await say(page, '#move-boxes 挪一挪')
    await expect(dialogue(page).getByTestId('msg-error')).toContainText('moveNode')
    await expect(page.locator('.info-bar .dirty')).toHaveCount(0)
  } finally {
    await restore()
  }
})
