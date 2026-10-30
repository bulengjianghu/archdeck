/**
 * 草图画布（§6.16，SK-12–SK-21，X22，ADR-0025）：导航树右键「在此设计」→ 新建设计 → 底稿按挂载点从基线（HEAD）复制、引用折叠、引用按层成列 →
 * 隐藏外部引用 → 合并两个 → 拖位置 →
 * 连关系 → 父模块原则 → 保存 → 文件含 mount / abstraction / layout / from → 刷新原样 → 面板两个核验数；根草图的层带与移入；
 * 持久草图（骨架）打开即草图画布，退出回到进入前的版本。
 * 设计目录建在真实的 model/h5p-arch-desk/designs/ 下，结束后删掉；指纹 owned.json 与拦截记录 ledger.jsonl 结束后恢复。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { parse } from 'yaml'
import { graphNode, openDesk, restoreOwned } from './helpers'

const PROJECT = path.resolve(import.meta.dirname, '../model/h5p-arch-desk')
const GOV = path.join(PROJECT, 'governance')
const OWNED = path.join(GOV, 'owned.json')
const LEDGER = path.join(GOV, 'ledger.jsonl')

test.describe.configure({ mode: 'serial' })

/**
 * 跑完删掉临时设计，并只撤销它自己留下的痕迹：owned.json 里该设计目录下的指纹、ledger.jsonl 里涉及该设计的行。
 * 不整份恢复这两个文件——其他 spec（如确认层）并行时也在写它们，整份恢复会把对方的临时写入写回去。
 */
function sandbox(design: string) {
  const dir = path.join(PROJECT, 'designs', design)
  const prefix = `designs/${design}/`
  const owned0 = fs.readFileSync(OWNED, 'utf8')
  return {
    dir,
    restore() {
      fs.rmSync(dir, { recursive: true, force: true })
      restoreOwned(OWNED, owned0, [prefix])
      if (fs.existsSync(LEDGER)) {
        const lines = fs.readFileSync(LEDGER, 'utf8').split('\n')
        const rest = lines.filter(l => !l.includes(`"design":"${design}"`) && !l.includes(`"file":"${prefix}`))
        if (rest.length !== lines.length) fs.writeFileSync(LEDGER, rest.join('\n'))
      }
    },
  }
}

/** 信息条动作区的「保存」（与「保存并交给 AI」区分） */
const saveButton = (page: Page) => page.locator('.info-bar').getByRole('button', { name: '保存', exact: true })

/**
 * 元素落定后的位置：连续两次读到的包围盒相同才返回。打开 / 切换草图后的「适应画布」要等节点量好尺寸（每 50ms 重试），
 * 节点可见时视野可能还没适应；原始鼠标拖动按旧坐标按下会落在空白处。
 */
async function settledBox(loc: Locator) {
  let prev = ''
  let box: Awaited<ReturnType<Locator['boundingBox']>> = null
  await expect
    .poll(
      async () => {
        box = await loc.boundingBox()
        const cur = JSON.stringify(box)
        const same = !!box && cur === prev
        prev = cur
        return same
      },
      { intervals: [120] },
    )
    .toBe(true)
  return box!
}

/** 从一个节点的连线柄拖到另一个节点中心（Vue Flow connect） */
async function dragConnect(page: Page, from: string, to: string) {
  const handle = graphNode(page, from).locator('.sk-out')
  const a = await settledBox(handle)
  const b = await settledBox(graphNode(page, to))
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.mouse.up()
}

/** 按住节点拖动 (dx, dy) 像素 */
async function dragBy(page: Page, id: string, dx: number, dy: number) {
  const b = await settledBox(graphNode(page, id).locator('.name'))
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 10 })
  await page.mouse.up()
}

const sketchFile = (dir: string, mount: string) => parse(fs.readFileSync(path.join(dir, `sketches/${mount}.yaml`), 'utf8')).sketch

const HEAD = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: PROJECT }).toString().trim()

/** 导航树里右键一个模块「在此设计」（先展开它的层） */
async function designHere(page: Page, layer: string, id: string) {
  const tree = page.locator('.module-tree')
  const row = (x: string) => tree.locator(`.row[data-id="${x}"]`)
  if (!(await row(id).isVisible())) await row(layer).locator('.caret').click()
  await row(id).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '在此设计' }).click()
}

test('SK-14–SK-19 主路径：导航树右键「在此设计」→ 对话框 → 底稿 14 个模块与折叠引用、引用按层成列、隐藏外部引用（X22）→ 合并两个 → 拖位置 → 连关系 → 父模块原则 → 保存 → 文件含 mount / abstraction / layout / from → 刷新原样 → 面板两个核验数与清单 → 拆分前二次确认（X7k）→ 拖出挂载点框 = 升级（X22）', async ({
  page,
}) => {
  const box = sandbox('zz-e2e-sketch')
  try {
    await openDesk(page, '/p/h5p-arch-desk')
    await designHere(page, 'state', 'state.desk')
    const dialog = page.getByRole('dialog', { name: '新建设计' })
    await expect(dialog.locator('select[name="design-mount"]')).toHaveValue('state.desk')
    await dialog.locator('input[name="design-name"]').fill('E2E 草图')
    await dialog.locator('input[name="design-goal"]').fill('合并编辑与版本')
    await dialog.locator('input[name="design-id"]').fill('zz-e2e-sketch')
    await dialog.getByRole('button', { name: '创建并打开草图' }).click()
    await expect(page).toHaveURL(/\/d\/zz-e2e-sketch\/sketch/)
    await expect(page.locator('.sketch-canvas')).toBeVisible()
    await expect(page.locator('.info-bar .name')).toHaveText('E2E 草图')
    await expect(saveButton(page)).toBeVisible()

    // 基线 = 仓库 HEAD；底稿：挂载点 DeskState 的一层从基线复制（14 个，波 3 G14 起含 state.desk.legend），不带职责文字；不写初始布局（X22：画布按中心区宽度排一次）
    expect(parse(fs.readFileSync(path.join(box.dir, 'design.yaml'), 'utf8')).design.base.commit).toBe(HEAD())
    const seed = sketchFile(box.dir, 'state.desk')
    expect(seed).toMatchObject({ id: 'zz-e2e-sketch', mount: 'state.desk' })
    const ids: string[] = seed.modules.map((m: { id: string }) => m.id)
    expect(ids).toHaveLength(14)
    expect(seed.modules.every((m: { responsibility?: string }) => !m.responsibility)).toBe(true)
    expect(seed.layout).toBeUndefined()
    for (const id of ids) await expect(graphNode(page, id)).toBeVisible()
    await expect(page.locator('.info-bar .mount')).toContainText('DeskState')
    // 折叠引用（05 裁决 4）：外部端点按挂载点深度折叠，引用节点少于精确端点；多条关系合成一条显示边、标条数
    const ends = new Set<string>((seed.relations as { from: string; to: string }[]).flatMap(r => [r.from, r.to]).filter(x => !ids.includes(x)))
    const refs = page.locator('.sk-ref')
    await expect(refs.first()).toBeVisible()
    expect(await refs.count()).toBeLessThan(ends.size)
    // ADR-0052：接到模型层入口的关系端点是 model 自身（撤掉门面模块），折叠后的引用至多到第二级
    for (const r of await refs.evaluateAll(els => els.map(e => e.closest('.vue-flow__node')!.getAttribute('data-id')!)))
      expect(r.split('.').length).toBeLessThanOrEqual(2)
    await expect(page.locator('.sk-ref .ref-count').first()).toBeVisible()
    // X22：引用按所属层成列——呈现层在中心区（挂载点框）左侧，同层的一列标「同层」在右侧，模型层在更右；框线带层名与挂载点名
    const frame = (kind: string, name?: string) =>
      page.locator(`.sk-frame[data-frame="${kind}"]`, name ? { has: page.locator('.frame-label', { hasText: name }) } : {})
    await expect(frame('center')).toContainText('DeskState')
    await expect(frame('system')).toContainText('h5p-arch-desk')
    const center = (await frame('center').boundingBox())!
    const presentCol = (await frame('column', '呈现层').boundingBox())!
    const sameCol = (await frame('column', '同层').boundingBox())!
    const modelCol = (await frame('column', '模型层').boundingBox())!
    expect(presentCol.x + presentCol.width).toBeLessThanOrEqual(center.x)
    expect(sameCol.x).toBeGreaterThanOrEqual(center.x + center.width)
    expect(modelCol.x).toBeGreaterThan(sameCol.x)
    expect(await graphNode(page, 'present.panel').evaluate(el => el.classList.contains('draggable'))).toBe(false)
    // X22：隐藏外部引用——引用列与引用线都不画，中心区占满；再点恢复；不改草图
    await page.getByRole('button', { name: '隐藏外部引用' }).click()
    await expect(refs).toHaveCount(0)
    await expect(frame('column')).toHaveCount(0)
    await expect(page.locator('.sk-edge.external')).toHaveCount(0)
    await page.getByRole('button', { name: '显示外部引用' }).click()
    await expect(refs.first()).toBeVisible()
    await expect(page.locator('.info-bar .dirty')).toHaveCount(0)
    await expect(page.locator('.sk-node.selected')).toHaveCount(0)

    // 合并两个：单击、⇧ 单击，右键「合并为新模块…」，中文名填 ID 短名
    const [a, b, c] = ids
    await graphNode(page, a).locator('.name').click()
    await graphNode(page, b)
      .locator('.name')
      .click({ modifiers: ['Shift'] })
    await expect(page.locator('.sk-node.selected')).toHaveCount(2)
    await graphNode(page, b).locator('.name').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /合并为新模块/ }).click()
    const merge = page.getByRole('dialog', { name: '合并为新模块' })
    await merge.locator('input[name="part-name"]').fill('编辑会话')
    await expect(merge.getByRole('button', { name: '合并' })).toBeDisabled()
    await merge.locator('input[name="part-id"]').fill('session')
    await merge.getByRole('button', { name: '合并' }).click()
    await expect(graphNode(page, 'state.desk.session')).toBeVisible()
    await expect(graphNode(page, a)).toHaveCount(0)
    await expect(graphNode(page, 'state.desk.session').locator('.badge')).toHaveText('合')
    await expect(page.locator('[data-testid="module-lineage"]')).toContainText('合并')

    // 拖位置：一步，可撤销
    const before = (await graphNode(page, 'state.desk.session').boundingBox())!
    // 小步拖动：画布按名义尺寸适应视口，缩放后相邻模块很近，拖远了会落到别的模块上（= 降级）
    await dragBy(page, 'state.desk.session', 40, 20)
    await expect.poll(async () => (await graphNode(page, 'state.desk.session').boundingBox())!.x).toBeGreaterThan(before.x + 25)

    // 连关系：从连线柄拖到另一个节点，类型缺省为委托（X23）+ 一句说明
    await dragConnect(page, 'state.desk.session', c)
    const connect = page.getByRole('dialog', { name: '新建关系' })
    await connect.locator('input[name="rel-description"]').fill('E2E 连线')
    await connect.getByRole('button', { name: '连上' }).click()
    await expect(page.locator('.sk-edge-label', { hasText: 'E2E 连线' })).toBeVisible()

    // 面板写父模块原则：无选中时为父模块，名称与职责只读，原则失焦提交一步
    await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
    const parent = page.locator('[data-testid="sketch-parent"]')
    await expect(parent).toContainText('DeskState')
    await parent.locator('textarea[name="mount-principle"]').fill('协调者只持有一个值')
    await parent.locator('textarea[name="mount-principle"]').blur()

    // 保存（⌘S）：整个设计写回；文件含 mount / abstraction / layout / from
    await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('ControlOrMeta+s')
    await expect(page.locator('.sk-notice')).toContainText('已保存')
    const saved = sketchFile(box.dir, 'state.desk')
    expect(saved.mount).toBe('state.desk')
    expect(saved.abstraction).toBe('协调者只持有一个值')
    const session = saved.modules.find((m: { id: string }) => m.id === 'state.desk.session')
    expect(session).toMatchObject({ name: '编辑会话', from: [a, b] })
    expect(saved.modules.some((m: { id: string }) => m.id === a)).toBe(false)
    expect(saved.layout.modules['state.desk.session']).toBeDefined()
    // X22：引用节点的位置不写回——layout 只有本层模块
    expect(Object.keys(saved.layout.modules).every(id => id.startsWith('state.desk.'))).toBe(true)
    expect(saved.relations).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: 'state.desk.session', to: c, type: 'commands', description: 'E2E 连线' })]),
    )
    // 合并写入的下一层与推出结果相同：不写文件（X20、T1 裁决 5）
    expect(fs.existsSync(path.join(box.dir, 'sketches/state.desk.session.yaml'))).toBe(false)
    const pos = saved.layout.modules['state.desk.session']

    // 刷新原样：位置、合并结果、关系与原则都在
    await page.reload()
    await expect(graphNode(page, 'state.desk.session')).toBeVisible()
    await expect(graphNode(page, a)).toHaveCount(0)
    await expect(page.locator('.sk-edge-label', { hasText: 'E2E 连线' })).toBeVisible()
    const x = await page.evaluate(
      () =>
        (globalThis as unknown as { __desk: { edit: { sketch: { value: { layout: { modules: Record<string, { x: number }> } } } } } }).__desk.edit.sketch.value
          .layout.modules['state.desk.session'].x,
    )
    expect(x).toBe(pos.x)
    await expect(page.locator('textarea[name="mount-principle"]')).toHaveValue('协调者只持有一个值')

    // 面板的两个核验数（本张）：相对基线改了 N 处，清单含「合并」；相对当前版本 N 处偏差
    const vb = page.locator('[data-testid="verify-baseline"]')
    await expect(vb.locator('summary')).toContainText(/相对基线：改了 [1-9]\d* 处/)
    await vb.locator('summary').click()
    await expect(vb).toContainText('合并')
    await expect(page.locator('[data-testid="verify-current"] summary')).toContainText(/相对当前版本：\d+ 处偏差/)

    // 下钻：合并结果的下一层由血缘推出，来源成为它的子模块；面包屑返回
    await graphNode(page, 'state.desk.session').dblclick()
    await expect(graphNode(page, `state.desk.session.${a.split('.').pop()}`)).toBeVisible()
    const crumbs = page.locator('.info-bar .mount')
    await expect(crumbs).toContainText('编辑会话')
    await expect(crumbs.locator('.here')).toContainText('编辑会话')
    // 升级：把下一层的一个模块拖到信息条面包屑的父级（data-parent）上 = 升级到父层（落点高亮）
    const child = `state.desk.session.${b.split('.').pop()}`
    const parentCrumb = crumbs.locator('[data-parent="1"]')
    await expect(parentCrumb).toContainText('DeskState')
    const from = await settledBox(graphNode(page, child).locator('.name'))
    const to = await settledBox(parentCrumb)
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 })
    await expect(parentCrumb).toHaveClass(/drop/)
    await page.mouse.up()
    await expect(graphNode(page, child)).toHaveCount(0)
    await crumbs.locator('.crumb', { hasText: 'DeskState' }).click()
    await expect(graphNode(page, 'state.desk.session')).toBeVisible()
    await expect(graphNode(page, `state.desk.${b.split('.').pop()}`)).toBeVisible()

    // X7k：拆分有下一层草图的模块前二次确认（下一层已因升级改过）——取消留在拆分对话框，确认后拆分，撤销一步恢复
    await graphNode(page, 'state.desk.session').locator('.name').click({ button: 'right' })
    await page.getByRole('menuitem', { name: '拆分…' }).click()
    const split = page.getByRole('dialog', { name: '拆分「编辑会话」', exact: true })
    const names = split.locator('input[name="part-name"]')
    const shorts = split.locator('input[name="part-id"]')
    await names.nth(0).fill('读')
    await shorts.nth(0).fill('sess-read')
    await names.nth(1).fill('写')
    await shorts.nth(1).fill('sess-write')
    await split.getByRole('button', { name: '拆分', exact: true }).click()
    const sure = page.getByRole('dialog', { name: '拆分「编辑会话」？' })
    await expect(sure).toContainText('拆分会删除它的下一层草图 state.desk.session.yaml（1 个模块）')
    await sure.getByRole('button', { name: '取消' }).click()
    await expect(sure).toHaveCount(0)
    await expect(split).toBeVisible()
    await expect(graphNode(page, 'state.desk.session')).toBeVisible()
    await split.getByRole('button', { name: '拆分', exact: true }).click()
    await sure.getByRole('button', { name: '拆分', exact: true }).click()
    await expect(graphNode(page, 'state.desk.sess-read')).toBeVisible()
    // 原模块的关系列为待重连（原端点暂以引用节点显示）
    await expect(page.locator('.sk-notice')).toContainText('待重连')
    await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('ControlOrMeta+z')
    await expect(graphNode(page, 'state.desk.session')).toBeVisible()
    await expect(graphNode(page, 'state.desk.sess-read')).toHaveCount(0)

    // X22：拖出中心区（挂载点框）松手 = 升级——系统框高亮落点，下一层的模块回到父层；撤销一步恢复
    await graphNode(page, 'state.desk.session').dblclick()
    const rest = `state.desk.session.${a.split('.').pop()}`
    await expect(graphNode(page, rest)).toBeVisible()
    const grip = await settledBox(graphNode(page, rest).locator('.name'))
    const frameBox = await settledBox(frame('center'))
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(frameBox.x - 12, frameBox.y + frameBox.height / 2, { steps: 15 })
    await expect(frame('system')).toHaveClass(/drop/)
    await expect(parentCrumb).toHaveClass(/drop/)
    await page.mouse.up()
    await expect(graphNode(page, rest)).toHaveCount(0)
    await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('ControlOrMeta+z')
    await expect(graphNode(page, rest)).toBeVisible()
    await crumbs.locator('.crumb', { hasText: 'DeskState' }).click()
    await expect(graphNode(page, 'state.desk.session')).toBeVisible()

    // 保存并交给 AI（#20a）：有未保存改动时一步保存再复制指令；指令含草图全文与相对基线的变更
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const hand = page.locator('.info-bar').getByRole('button', { name: /交给 AI$/ })
    await expect(hand.locator('.txt')).toHaveText('保存并交给 AI')
    await hand.click()
    // 保存、重新读入（服务端读 git 算基线与改动摘要）再复制：全量并行跑时服务端偏慢，多给等待（第五轮 T4）；失败时带出按钮文字与信息条说明
    await expect
      .poll(
        async () => {
          const txt = await page.locator('.info-bar .hand .txt').textContent()
          if (txt === '已复制指令') return 'ok'
          const note = page.locator('.info-bar .note')
          return `pending: ${txt}${(await note.count()) ? ` / note: ${await note.textContent()}` : ''}`
        },
        { timeout: 30_000 },
      )
      .toBe('ok')
    const prompt = await page.evaluate<string>('navigator.clipboard.readText()')
    expect(prompt).toContain('# 按草图扩展：设计「zz-e2e-sketch」')
    expect(prompt).toContain('## 相对基线的变更（按血缘）')
    await expect(page.locator('.info-bar .dirty')).toHaveCount(0)
  } finally {
    box.restore()
  }
})

test('X21 根草图：设计面板「改骨架」→ 层画成带 → 拖到另一条带 = 移入 → 保存后模块换了层、layout 记 x 与相对带顶的 y', async ({ page }) => {
  const box = sandbox('zz-e2e-root')
  try {
    await openDesk(page, '/p/h5p-arch-desk')
    await designHere(page, 'state', 'state.desk')
    const dialog = page.getByRole('dialog', { name: '新建设计' })
    await dialog.locator('input[name="design-name"]').fill('E2E 根草图')
    await dialog.locator('input[name="design-id"]').fill('zz-e2e-root')
    await dialog.getByRole('button', { name: '创建并打开草图' }).click()
    await expect(page.locator('.sketch-canvas')).toBeVisible()
    await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.locator('[data-testid="design-sketches"]').getByRole('button', { name: '改骨架' }).click()

    // 层带：四条，按 order；第二级模块在所属带内
    await expect(page.locator('.sk-band')).toHaveCount(4)
    const node = graphNode(page, 'state.transition')
    await expect(node).toBeVisible()
    await page.locator('.sk-zoom').getByRole('button', { name: '适应' }).click()
    // 拖到接入层带上 = 移入
    const from = (await node.locator('.name').boundingBox())!
    const band = (await page.locator('.sk-band[data-band="access"]').boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    const flow = (await page.locator('.sk-flow').boundingBox())!
    // 落点在带的上缘（模块在带的中间一行，落在模块上是降级）
    await page.mouse.move(Math.min(band.x + band.width, flow.x + flow.width) / 2 + band.x / 2, band.y + band.height * 0.12, { steps: 15 })
    await expect(page.locator('.sk-band[data-band="access"]')).toHaveClass(/drop/)
    await page.mouse.up()
    await expect(graphNode(page, 'access.transition')).toBeVisible()
    await expect(graphNode(page, 'state.transition')).toHaveCount(0)

    await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('ControlOrMeta+s')
    await expect(page.locator('.sk-notice')).toContainText('已保存')
    const root = sketchFile(box.dir, 'root')
    expect(root.mount).toBe('root')
    const layer = (id: string) => root.modules.find((m: { id: string }) => m.id === id)
    expect(layer('access').children.map((m: { id: string }) => m.id)).toContain('access.transition')
    expect(layer('state').children.map((m: { id: string }) => m.id)).not.toContain('state.transition')
    expect(layer('access').children.find((m: { id: string }) => m.id === 'access.transition').from).toEqual(['state.transition'])
    expect(Object.keys(root.layout.modules['access.transition'])).toEqual(['x', 'y'])
    expect(root.layout.modules.access).toBeUndefined()
  } finally {
    box.restore()
  }
})

test('E-1、#20b：从当前版本点「编辑骨架」打开持久草图即进入草图画布（层画成带）；信息条「退出」回到进入前的版本；版本切换选「✎ 骨架」后索引只有骨架的实体', async ({
  page,
}) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await page.getByRole('button', { name: '编辑骨架' }).click()
  await expect(page).toHaveURL(/\/p\/h5p-arch-desk\/i\/skeleton/)
  await expect(page.locator('.sketch-canvas')).toBeVisible()
  await expect(page.locator('.info-bar .name')).toHaveText('骨架')
  await expect(saveButton(page)).toBeVisible()
  await expect(page.locator('.sk-band')).toHaveCount(4)
  // 持久草图只有「相对当前版本」（偏差，与命令行 sketch-check 同一口径，X17）：骨架与当前版本一致时 0 偏差、按钮 +0 ~0；草图下没有视角切换、导航树不另列路径
  await expect(page.locator('[data-testid="verify-current"] summary')).toContainText('相对当前版本：0 处偏差')
  const cmp = page.locator('.info-bar .cmp-btn')
  await expect(cmp).toContainText('对比 相对当前版本')
  await expect(cmp.locator('b[title="新增"]')).toHaveText('+0')
  await expect(cmp.locator('b[title="修改"]')).toHaveText('~0')
  // 「交给 AI 时的改动摘要」（与去掉这张草图后的当前版本比）只在「说明」里单独一节，不进计数
  await page.locator('.info-bar').getByRole('button', { name: '说明', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '变更清单' }).locator('[data-testid="handoff-summary"]')).toContainText('交给 AI 时的改动摘要')
  await page.keyboard.press('Escape')
  await cmp.click()
  await expect(page.getByRole('dialog', { name: '对比设置' }).getByLabel('相对基线')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('group', { name: '视角' })).toHaveCount(0)
  await expect(page.locator('[data-testid="sketch-tree"]')).not.toContainText('本张草图')
  // 退出：没有改动，直接回到进入草图之前的版本（当前版本）
  await page.locator('.info-bar').getByRole('button', { name: '退出', exact: true }).click()
  await expect(page).not.toHaveURL(/\/i\/skeleton/)
  await expect(page.locator('.sketch-canvas')).toHaveCount(0)
  await expect(page.locator('.info-bar')).toHaveCount(0)

  // 当前视图的模型索引里有没有这个模块（加载中为 null）
  const has = (id: string) =>
    page.evaluate(
      x => (globalThis as unknown as { __desk?: { index: { value: { modules: Map<string, unknown> } | null } } }).__desk?.index.value?.modules.has(x) ?? null,
      id,
    )
  await expect.poll(() => has('state.desk.edit')).toBe(true)
  await page.locator('select[aria-label="切换版本"]').selectOption('i:skeleton')
  await expect(page.locator('.info-bar .kind')).toHaveText('草图')
  await expect(page.locator('.info-bar .chip')).toContainText('持久')
  await expect.poll(() => has('state.desk.edit')).toBe(false)
  await expect.poll(() => has('state.desk')).toBe(true)
  await expect(page.locator('.sk-band')).toHaveCount(4)
})

const BAR_SKETCH = `sketch:
  id: zz-e2e-bar
  mount: state.desk
  lifetime: until-implemented
  modules:
    - { id: state.desk.alpha, name: Alpha }
    - { id: state.desk.beta, name: Beta }
  relations:
    - { id: rel.zz-alpha-beta, from: state.desk.alpha, to: state.desk.beta, type: calls }
`

test('F-60–F-62、#15、#20b：草图的信息条只出现一次名称、唯一一条面包屑；对比按钮六类计数、弹层切口径（图上标出跟随）、没有基线提交时提示、Esc 关闭；有改动时退出弹三选，取消留下、放弃后回到进入草图之前的版本', async ({
  page,
}) => {
  const box = sandbox('zz-e2e-bar')
  try {
    fs.mkdirSync(path.join(box.dir, 'sketches'), { recursive: true })
    fs.writeFileSync(path.join(box.dir, 'design.yaml'), 'design:\n  name: E2E 信息条\n  status: draft\n')
    fs.writeFileSync(path.join(box.dir, 'sketches/state.desk.yaml'), BAR_SKETCH)
    await openDesk(page, '/p/h5p-arch-desk')
    await page.locator('select[aria-label="切换版本"]').selectOption('zz-e2e-bar/sketch')
    const bar = page.locator('.info-bar')
    await expect(page.locator('.sketch-canvas')).toBeVisible()
    await expect(saveButton(page)).toBeVisible()

    // 身份区：kind + 名称（只这一次）+ 状态 + 唯一一条面包屑；不再有「编辑草图：」「尺子」「校验」「放弃」「编辑」
    await expect(bar.locator('.kind')).toHaveText('草图')
    expect((await bar.innerText()).split('E2E 信息条').length - 1).toBe(1)
    await expect(bar).toContainText('起草中')
    await expect(bar.locator('.mount')).toContainText(/挂在：.*视图状态层 › DeskState/)
    await expect(bar.locator('.mount [data-parent="1"]')).toHaveCount(1)
    await expect(page.locator('.sk-crumbs')).toHaveCount(0)
    for (const gone of ['编辑草图：', '尺子', '删除项', '校验', '放弃']) await expect(bar).not.toContainText(gone)
    await expect(bar.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0)

    // 改一处：编辑中 ●，「交给 AI」变成「保存并交给 AI」
    await graphNode(page, 'state.desk.beta').locator('.name').click()
    const name = page.locator('[data-testid="sketch-module-form"] [name="module-name"]')
    await name.fill('Beta 改')
    await name.press('Enter')
    await expect(bar.locator('.dirty')).toHaveText('编辑中 ●')
    await expect(bar.getByRole('button', { name: '保存并交给 AI' })).toBeVisible()

    // 对比：一个按钮——新增 / 修改始终显示，合并 / 拆分 / 移动 / 删除只在非 0 时显示；弹层里六类计数、切口径，没有基线提交时提示退化；全设计清单按血缘分组
    const cmp = bar.locator('.cmp-btn')
    await expect(cmp).toContainText('对比 相对基线')
    for (const t of ['新增', '修改']) await expect(cmp.locator(`b[title="${t}"]`)).toHaveCount(1)
    for (const t of ['合并', '拆分', '移动']) await expect(cmp.locator(`b[title="${t}"]`)).toHaveCount(0)
    // 这张草图只画了 DeskState 的两个子模块、又没有基线提交（相对基线 = 相对当前版本）：范围内没画的计为删除，非 0 即显示
    await expect(cmp.locator('b[title="删除"]')).not.toHaveText('−0')
    await cmp.click()
    const pop = page.getByRole('dialog', { name: '对比设置' })
    for (const t of ['新增', '修改', '合并', '拆分', '移动', '删除']) await expect(pop.locator('.counts')).toContainText(t)
    await expect(pop.locator('[data-testid="baseline-fallback"]')).toContainText('相对基线 = 相对当前版本')
    await expect(pop.locator('[data-testid="change-groups"]')).toBeVisible()
    await pop.getByLabel('相对当前版本').check()
    await expect(cmp).toContainText('对比 相对当前版本')
    expect(await page.evaluate(() => (globalThis as unknown as { __desk: { edit: { compareMode: { value: string } } } }).__desk.edit.compareMode.value)).toBe(
      'current',
    )
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)

    // 说明：全设计变更清单（按血缘分组）的弹层
    await bar.getByRole('button', { name: '说明', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '变更清单' }).locator('[data-testid="change-groups"]')).toBeVisible()
    await page.keyboard.press('Escape')

    // 退出：有改动时三选；取消留在草图，放弃后回到进入草图之前的版本
    await bar.getByRole('button', { name: '退出', exact: true }).click()
    const ask = page.getByRole('dialog', { name: /有未保存的改动/ })
    await expect(ask.getByRole('button')).toHaveText(['取消', '放弃', '保存'])
    await ask.getByRole('button', { name: '取消' }).click()
    await expect(bar.locator('.dirty')).toBeVisible()
    await bar.getByRole('button', { name: '退出', exact: true }).click()
    await ask.getByRole('button', { name: '放弃' }).click()
    await expect(page).not.toHaveURL(/zz-e2e-bar/)
    expect(fs.readFileSync(path.join(box.dir, 'sketches/state.desk.yaml'), 'utf8')).not.toContain('Beta 改')
  } finally {
    box.restore()
  }
})

test('T2b 裁决 6：当前版本上「在此设计」的对话框有「加到设计 <名>」（有草稿设计时）——选中后打开那个设计的草图并切到挂在该模块上的一张（按基线推出，未改动不写文件）', async ({
  page,
}) => {
  const box = sandbox('zz-e2e-add')
  try {
    fs.mkdirSync(path.join(box.dir, 'sketches'), { recursive: true })
    fs.writeFileSync(path.join(box.dir, 'design.yaml'), 'design:\n  name: E2E 加一张\n  status: draft\n')
    fs.writeFileSync(path.join(box.dir, 'sketches/state.desk.yaml'), BAR_SKETCH.replace('id: zz-e2e-bar', 'id: zz-e2e-add'))
    await openDesk(page, '/p/h5p-arch-desk')
    await designHere(page, 'state', 'state.transition')
    const dialog = page.getByRole('dialog', { name: '新建设计' })
    await expect(dialog.getByRole('radio', { name: '新建设计' })).toBeChecked()
    await dialog.getByRole('radio', { name: /加到设计/ }).check()
    const target = dialog.locator('select[name="design-target"]')
    if (await target.count()) await target.selectOption('zz-e2e-add')
    await expect(dialog.locator('input[name="design-name"]')).toHaveCount(0)
    await expect(dialog.locator('select[name="design-mount"]')).toHaveValue('state.transition')
    await dialog.getByRole('button', { name: '加到设计并打开草图' }).click()

    await expect(page).toHaveURL(/\/d\/zz-e2e-add\/sketch/)
    await expect(page.locator('.sketch-canvas')).toBeVisible()
    const crumbs = page.locator('.info-bar .mount')
    await expect(crumbs.locator('.here')).toHaveAttribute('data-crumb', 'state.transition')
    await expect(page.locator('.info-bar .name')).toHaveText('E2E 加一张')
    // 推出的那张没改动：不脏、不写文件
    await expect(page.locator('.info-bar .dirty')).toHaveCount(0)
    expect(fs.existsSync(path.join(box.dir, 'sketches/state.transition.yaml'))).toBe(false)
  } finally {
    box.restore()
  }
})

test('草图画布手势：按住空格拖动空白处 = 平移（视口变、不框选、不移动节点、不变脏），松开空格恢复框选；光标为抓手', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await page.getByRole('button', { name: '编辑骨架' }).click()
  await expect(page.locator('.sk-band')).toHaveCount(4)
  await expect(page.locator('.sk-zoom')).toContainText('空格 + 拖动 = 平移，Ctrl + 滚轮 = 缩放')
  const viewport = page.locator('.sk-flow .vue-flow__transformationpane')
  const transform = () => viewport.getAttribute('style')
  const pane = page.locator('.sk-flow .vue-flow__pane')
  const node = graphNode(page, 'state.transition')
  await settledBox(node)
  const t0 = await transform()
  const n0 = await page.evaluate(() => JSON.stringify((globalThis as unknown as { __desk: { edit: { sketch: { value: unknown } } } }).__desk.edit.sketch.value))
  const flow = (await page.locator('.sk-flow').boundingBox())!
  // 起点取画布的空白处：适应画布后四周留白，但模型层改成四层后左上角可能压到带名，按网格找一块空白
  const { sx, sy } = await page.evaluate(() => {
    type Rect = { left: number; top: number; width: number; height: number }
    const doc = (
      globalThis as unknown as {
        document: {
          querySelector(sel: string): { getBoundingClientRect(): Rect } | null
          elementFromPoint(x: number, y: number): { classList: { contains(c: string): boolean } } | null
        }
      }
    ).document
    const flow = doc.querySelector('.sk-flow')!.getBoundingClientRect()
    // 在画布内按网格找一块空白（向右、向下各留出 200 / 120 px 供拖动）
    for (let dy = 16; dy < flow.height - 120; dy += 40) {
      for (let dx = 16; dx < flow.width - 200; dx += 40) {
        const x = flow.left + dx
        const y = flow.top + dy
        const el = doc.elementFromPoint(x, y)
        if (el && el.classList.contains('vue-flow__pane')) return { sx: x, sy: y }
      }
    }
    throw new Error('草图画布没有空白处可起拖')
  })

  await page.keyboard.down('Space')
  await expect(page.locator('.sketch-canvas')).toHaveClass(/panning/)
  await expect(pane).toHaveCSS('cursor', 'grab')
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + 160, sy + 90, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await expect(page.locator('.sketch-canvas')).not.toHaveClass(/panning/)

  await expect.poll(transform).not.toBe(t0)
  await expect(page.locator('.vue-flow__selection, .vue-flow__nodesselection')).toHaveCount(0)
  await expect(page.locator('.sk-node.selected')).toHaveCount(0)
  await expect(page.locator('.info-bar .dirty')).toHaveCount(0)
  expect(
    await page.evaluate(() => JSON.stringify((globalThis as unknown as { __desk: { edit: { sketch: { value: unknown } } } }).__desk.edit.sketch.value)),
  ).toBe(n0)
  // 页面不因空格滚动
  expect(await page.evaluate<number[]>('[window.scrollY, document.scrollingElement?.scrollTop ?? 0]')).toEqual([0, 0])

  // 松开空格后空白处拖动恢复框选：框住整张画布，视口不动、选中模块
  const t1 = await transform()
  await page.mouse.move(flow.x + 8, flow.y + 8)
  await page.mouse.down()
  await page.mouse.move(flow.x + flow.width - 8, flow.y + flow.height - 8, { steps: 10 })
  await page.mouse.up()
  expect(await transform()).toBe(t1)
  await expect(page.locator('.sk-node.selected').first()).toBeVisible()

  // 焦点在面板输入框时空格照常输入，不进入平移
  await page.keyboard.press('Escape')
  await graphNode(page, 'state.transition').locator('.name').click()
  const input = page.locator('[data-testid="sketch-panel"] textarea[name="module-responsibility"]')
  await input.click()
  await page.keyboard.type('a')
  await page.keyboard.down('Space')
  await expect(page.locator('.sketch-canvas')).not.toHaveClass(/panning/)
  await page.keyboard.up('Space')
  await page.keyboard.type('b')
  await expect(input).toHaveValue(/a b/)
})

const SIZE_SKETCH = `sketch:
  id: zz-e2e-size
  mount: state.desk
  lifetime: until-implemented
  modules:
    - { id: state.desk.alpha, name: Alpha }
    - { id: state.desk.beta, name: Beta }
    - { id: state.desk.gamma, name: Gamma }
    - { id: state.desk.delta, name: Delta }
    - { id: state.desk.epsilon, name: Epsilon }
  relations:
    - { id: rel.zz-alpha-beta, from: state.desk.alpha, to: state.desk.beta, type: calls }
    - { id: rel.zz-present, from: present.sketch, to: state.desk.alpha, type: calls }
    - { id: rel.zz-layout, from: state.desk.beta, to: state.layout, type: calls }
    - { id: rel.zz-writer, from: state.desk.gamma, to: access.writer, type: calls }
    - { id: rel.zz-intent, from: state.desk.delta, to: model.intent, type: calls }
  layout:
    modules:
      state.desk.alpha: { x: 0, y: 0 }
      state.desk.beta: { x: 220, y: 0 }
      state.desk.gamma: { x: 440, y: 0 }
      state.desk.delta: { x: 0, y: 160 }
      state.desk.epsilon: { x: 220, y: 160 }
`

/** 设了 E2E_SHOTS（目录）时把各宽度下的草图画布截图存进去，供评审 */
const SHOTS = process.env.E2E_SHOTS

test('X22（第五轮 T3）：草图画布的系统框随可用区域自适应——1000 / 1440 / 1900 宽下系统框占满画布、中心区占满高、最右一列贴着系统框；改窗口尺寸后重算，本层坐标不动', async ({
  page,
}) => {
  const box = sandbox('zz-e2e-size')
  try {
    fs.mkdirSync(path.join(box.dir, 'sketches'), { recursive: true })
    fs.writeFileSync(path.join(box.dir, 'design.yaml'), 'design:\n  name: E2E 画布尺寸\n  status: draft\n')
    fs.writeFileSync(path.join(box.dir, 'sketches/state.desk.yaml'), SIZE_SKETCH)
    await openDesk(page, '/p/h5p-arch-desk')
    await page.locator('select[aria-label="切换版本"]').selectOption('zz-e2e-size/sketch')
    await expect(page.locator('.sketch-canvas')).toBeVisible()
    const sys = graphNode(page, 'frame:system')
    const center = graphNode(page, 'frame:center')
    const desk = () =>
      page.evaluate(() => {
        const d = (
          globalThis as unknown as {
            __desk: { edit: { scene: { value: { origin: { x: number; y: number }; nodes: { id: string; position: { x: number; y: number } }[] } } } }
          }
        ).__desk
        const s = d.edit.scene.value
        const m = s.nodes.find(n => n.id === 'state.desk.alpha')!
        return { x: m.position.x - s.origin.x, y: m.position.y - s.origin.y }
      })
    let rel0: { x: number; y: number } | null = null
    for (const width of [1440, 1000, 1900]) {
      await page.setViewportSize({ width, height: width === 1000 ? 760 : width === 1440 ? 900 : 1040 })
      const flow = page.locator('.sk-flow')
      // 系统框与画布容器重合（无空白带）：等 ResizeObserver 量到、重算并重新适应
      await expect
        .poll(async () => {
          const f = (await flow.boundingBox())!
          const s = (await sys.boundingBox())!
          return Math.max(Math.abs(f.x - s.x), Math.abs(f.y - s.y), Math.abs(f.width - s.width), Math.abs(f.height - s.height))
        })
        .toBeLessThan(3)
      const f = (await flow.boundingBox())!
      const c = (await settledBox(center))!
      const style = (await page.locator('.sk-flow .vue-flow__transformationpane').getAttribute('style')) ?? ''
      const zoom = Number(/scale\(([\d.]+)\)/.exec(style)?.[1] ?? 1)
      // 放不下四列引用与最小中心区时整体缩小，但系统框仍占满画布
      // 中心区占满高（只留系统框内边距），宽 = 画布宽 − 两侧引用列宽
      expect(Math.abs(c.height - (f.height - 2 * 28 * zoom))).toBeLessThan(3)
      const cols = page.locator('.vue-flow__node[data-id^="frame:col:"]')
      await expect(cols).toHaveCount(4)
      const right = Math.max(...(await Promise.all((await cols.all()).map(async x => (await x.boundingBox())!))).map(b => b.x + b.width))
      expect(Math.abs(f.x + f.width - 28 * zoom - right)).toBeLessThan(3)
      const rel = await desk()
      if (rel0) expect(rel).toEqual(rel0)
      rel0 = rel
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true })
        await page.screenshot({ path: path.join(SHOTS, `sketch-canvas-${width}.png`) })
      }
    }
    // 「适应」按内容外框：视野回到系统框
    await page.locator('.sk-zoom').getByRole('button', { name: '适应' }).click()
    await expect
      .poll(async () => {
        const f = (await page.locator('.sk-flow').boundingBox())!
        const s = (await sys.boundingBox())!
        return Math.abs(f.width - s.width)
      })
      .toBeLessThan(3)
  } finally {
    box.restore()
  }
})

test('X7a（第五轮 T3）：有未保存改动时切换版本、浏览器后退都弹「保存 / 放弃 / 取消」三选（与「退出」同一个对话框）——取消留下且下拉复原，保存后再离开，后退选放弃则丢掉改动', async ({
  page,
}) => {
  const box = sandbox('zz-e2e-leave')
  try {
    fs.mkdirSync(path.join(box.dir, 'sketches'), { recursive: true })
    fs.writeFileSync(path.join(box.dir, 'design.yaml'), 'design:\n  name: E2E 离开\n  status: draft\n')
    fs.writeFileSync(path.join(box.dir, 'sketches/state.desk.yaml'), BAR_SKETCH.replace('id: zz-e2e-bar', 'id: zz-e2e-leave'))
    const file = path.join(box.dir, 'sketches/state.desk.yaml')
    await openDesk(page, '/p/h5p-arch-desk')
    const switcher = page.locator('select[aria-label="切换版本"]')
    await switcher.selectOption('zz-e2e-leave/sketch')
    await expect(page.locator('.sketch-canvas')).toBeVisible()
    const rename = async (text: string) => {
      await graphNode(page, 'state.desk.beta').locator('.name').click()
      const name = page.locator('[data-testid="sketch-module-form"] [name="module-name"]')
      await name.fill(text)
      await name.press('Enter')
      await expect(page.locator('.info-bar .dirty')).toBeVisible()
    }
    const ask = page.getByRole('dialog', { name: /有未保存的改动/ })

    // 切换版本 → 三选；取消：留在草图、仍脏、下拉回到这张草图
    await rename('Beta 存')
    await switcher.selectOption('')
    await expect(ask.getByRole('button')).toHaveText(['取消', '放弃', '保存'])
    await ask.getByRole('button', { name: '取消' }).click()
    await expect(page).toHaveURL(/zz-e2e-leave\/sketch/)
    await expect(page.locator('.info-bar .dirty')).toBeVisible()
    await expect(switcher).toHaveValue('zz-e2e-leave/sketch')

    // 再切换 → 保存：写进文件后离开
    await switcher.selectOption('')
    await ask.getByRole('button', { name: '保存' }).click()
    await expect(page).not.toHaveURL(/zz-e2e-leave/)
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('Beta 存')

    // 后退回到草图（无改动不问），再改一处后浏览器后退 → 三选，放弃：改动丢掉、回到前一个地址
    await page.goBack()
    await expect(page).toHaveURL(/zz-e2e-leave\/sketch/)
    await expect(page.locator('.sketch-canvas')).toBeVisible()
    await rename('Beta 弃')
    await page.goBack()
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: '放弃' }).click()
    await expect(page).not.toHaveURL(/zz-e2e-leave/)
    expect(fs.readFileSync(file, 'utf8')).not.toContain('Beta 弃')
  } finally {
    box.restore()
  }
})

test('X7d（第五轮 T3）：草图面板改 ID 时提交前预览影响（后代、关系、下一层草图文件、当前版本的引用），有影响二次确认——取消不改，确认后前缀级联', async ({
  page,
}) => {
  const box = sandbox('zz-e2e-rename')
  try {
    fs.mkdirSync(path.join(box.dir, 'sketches'), { recursive: true })
    fs.writeFileSync(path.join(box.dir, 'design.yaml'), 'design:\n  name: E2E 改 ID\n  status: draft\n')
    fs.writeFileSync(path.join(box.dir, 'sketches/state.desk.yaml'), BAR_SKETCH.replace('id: zz-e2e-bar', 'id: zz-e2e-rename'))
    await openDesk(page, '/p/h5p-arch-desk')
    await page.locator('select[aria-label="切换版本"]').selectOption('zz-e2e-rename/sketch')
    await expect(page.locator('.sketch-canvas')).toBeVisible()
    await graphNode(page, 'state.desk.alpha').locator('.name').click()
    const form = page.locator('[data-testid="sketch-module-form"]')
    const id = form.locator('[name="module-id"]')
    await id.fill('alpha2')
    // 输入时即时预览：一条关系随之改写
    const impact = form.locator('[data-testid="rename-impact"]')
    await expect(impact).toContainText('受影响的关系：1 条')
    await expect(impact).toContainText('级联改名的后代模块：0 个')
    await expect(impact).toContainText('当前版本里引用旧 ID 的：0 处')
    await id.press('Enter')
    const ask = page.getByRole('dialog', { name: /state\.desk\.alpha.*state\.desk\.alpha2/ })
    await expect(ask).toContainText('受影响的关系：1 条')
    await ask.getByRole('button', { name: '取消' }).click()
    await expect(id).toHaveValue('alpha')
    await expect(graphNode(page, 'state.desk.alpha')).toBeVisible()

    await id.fill('alpha2')
    await id.press('Enter')
    await ask.getByRole('button', { name: '改 ID' }).click()
    await expect(graphNode(page, 'state.desk.alpha2')).toBeVisible()
    await expect(graphNode(page, 'state.desk.alpha')).toHaveCount(0)
    expect(
      await page.evaluate(() =>
        (globalThis as unknown as { __desk: { edit: { sketch: { value: { relations: { from: string }[] } } } } }).__desk.edit.sketch.value.relations.map(
          r => r.from,
        ),
      ),
    ).toEqual(['state.desk.alpha2'])
  } finally {
    box.restore()
  }
})

test('E9、DV-13（第五轮 T3）：模块面板「相关决策」列编号与标题、单击在资料区预览，子模块只给上级决策的折叠行；草图模块表单可编辑 adrs 并写进草图文件', async ({
  page,
}) => {
  await openDesk(page, '/p/h5p-arch-desk?level=present&sel=m:present.sketch')
  // G11 V15c：「相关决策」折叠在 ⑤，展开再断言
  await page
    .locator('.panel')
    .getByRole('button', { name: /^▸ 相关决策/ })
    .click()
  const adrs = page.locator('[data-testid="module-adrs"]')
  await expect(adrs.locator('li')).toHaveCount(2)
  await expect(adrs.locator('[data-adr="25"]')).toContainText('ADR-0025')
  await expect(adrs.locator('[data-adr="25"]')).toContainText('草图是思考的介质')
  await adrs.locator('[data-adr="25"] button').click()
  await expect(page.locator('.source-view')).toContainText('ADR-0025')
  // 不继承：子模块不列祖先的决策，只给折叠行
  await openDesk(page, '/p/h5p-arch-desk?level=present.sketch&sel=m:present.sketch.canvas')
  const panel = page.locator('.module-panel')
  // G11 V15c：本模块没有写决策（展开的节里没有清单），上级决策折叠行在「相关决策」节里
  await panel.getByRole('button', { name: /^▸ 相关决策/ }).click()
  await expect(panel.locator('[data-testid="module-adrs"]')).toHaveCount(0)
  await panel.getByRole('button', { name: /上级模块的决策 2 条/ }).click()
  await expect(panel).toContainText('ADR-0024')
  // 上级决策同样列标题、单击在资料区预览（第五轮 T4）
  await expect(panel.locator('[data-adr="24"]')).toContainText('草图的画布编辑')
  await panel.locator('[data-adr="24"] button').click()
  await expect(page.locator('.source-view')).toContainText('ADR-0024')

  const box = sandbox('zz-e2e-adrs')
  try {
    fs.mkdirSync(path.join(box.dir, 'sketches'), { recursive: true })
    fs.writeFileSync(path.join(box.dir, 'design.yaml'), 'design:\n  name: E2E 决策\n  status: draft\n')
    fs.writeFileSync(path.join(box.dir, 'sketches/state.desk.yaml'), BAR_SKETCH.replace('id: zz-e2e-bar', 'id: zz-e2e-adrs'))
    await openDesk(page, '/p/h5p-arch-desk')
    await page.locator('select[aria-label="切换版本"]').selectOption('zz-e2e-adrs/sketch')
    await expect(page.locator('.sketch-canvas')).toBeVisible()
    await graphNode(page, 'state.desk.alpha').locator('.name').click()
    const field = page.locator('[data-testid="sketch-module-form"] [name="module-adrs"]')
    await field.fill('ADR-0025, 27, 25')
    await field.press('Enter')
    await expect(field).toHaveValue('25, 27')
    await saveButton(page).click()
    await expect
      .poll(() => (sketchFile(box.dir, 'state.desk').modules as { id: string; adrs?: number[] }[]).find(m => m.id === 'state.desk.alpha')?.adrs)
      .toEqual([25, 27])
  } finally {
    box.restore()
  }
})

test('X23、X24（第六轮 T3）：草图里声明端口与实现者（拖线到端口记号）、连一条经端口的委托——保存后文件含 type / via / implementedBy，重开后仍在', async ({
  page,
}) => {
  const box = sandbox('zz-e2e-ports')
  try {
    await openDesk(page, '/p/h5p-arch-desk')
    await designHere(page, 'state', 'state.desk')
    const dialog = page.getByRole('dialog', { name: '新建设计' })
    await dialog.locator('input[name="design-name"]').fill('E2E 端口')
    await dialog.locator('input[name="design-goal"]').fill('端口与经端口的委托')
    await dialog.locator('input[name="design-id"]').fill('zz-e2e-ports')
    await dialog.getByRole('button', { name: '创建并打开草图' }).click()
    await expect(page.locator('.sketch-canvas')).toBeVisible()
    const ids: string[] = sketchFile(box.dir, 'state.desk').modules.map((m: { id: string }) => m.id)
    const [owner, impl, user] = ids
    for (const id of [owner, impl, user]) await expect(graphNode(page, id)).toBeVisible()

    // 在定义模块上写接口：模块边上出现端口记号（实现者 0）
    await graphNode(page, owner).locator('.name').click()
    const form = page.locator('[data-testid="sketch-module-form"]')
    await form.locator('input[name="interface-name"]').fill('save')
    await form.locator('input[name="interface-name"]').press('Enter')
    const port = graphNode(page, owner).locator('.sk-port')
    await expect(port).toHaveCount(1)
    await expect(port).toContainText('save · 0')
    const portId = (await port.getAttribute('data-port'))!

    // X24：从另一个模块的连线柄拖到端口记号 = 声明它实现这个端口
    const a = await settledBox(graphNode(page, impl).locator('.sk-out'))
    const b = await settledBox(port)
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect(port).toContainText('save · 1')
    await expect(page.getByRole('dialog', { name: '新建关系' })).toHaveCount(0)

    // X23：连线选类型（缺省为委托）与机制「端口」→ 选端口
    await dragConnect(page, user, owner)
    const connect = page.getByRole('dialog', { name: '新建关系' })
    await expect(connect.getByRole('radio', { name: '托' })).toHaveAttribute('aria-checked', 'true')
    await connect.locator('select[name="rel-via-kind"]').selectOption('port')
    await connect.locator('select[name="rel-via-port"]').selectOption(portId)
    await connect.locator('input[name="rel-description"]').fill('经端口保存')
    await connect.getByRole('button', { name: '连上' }).click()
    await expect(page.locator('.sk-edge-label', { hasText: '经端口保存' })).toBeVisible()
    // L12：经端口的线在终点画插座
    await expect(page.locator('.sk-edge .socket')).toHaveCount(1)

    await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('ControlOrMeta+s')
    await expect(page.locator('.sk-notice')).toContainText('已保存')
    const saved = sketchFile(box.dir, 'state.desk')
    expect(saved.relations).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: user, to: owner, type: 'commands', via: `port:${portId}`, description: '经端口保存' })]),
    )
    expect(saved.interfaces).toEqual([expect.objectContaining({ id: portId, name: 'save', owner, implementedBy: [impl] })])

    // 重开原样：端口记号（实现者 1）与插座都在；面板的关系表单显示机制为端口
    await page.reload()
    await expect(graphNode(page, owner).locator('.sk-port')).toContainText('save · 1')
    await expect(page.locator('.sk-edge .socket')).toHaveCount(1)
    // 标签可能被重排后的节点盖住：直接派发按下（选中这条关系）
    await page.locator('.sk-edge-label', { hasText: '经端口保存' }).dispatchEvent('pointerdown')
    const rf = page.locator('[data-testid="sketch-relation-form"]')
    await expect(rf.locator('select[name="rel-via-kind"]')).toHaveValue('port')
    await expect(rf.locator('select[name="rel-via-port"]')).toHaveValue(portId)
  } finally {
    box.restore()
  }
})
