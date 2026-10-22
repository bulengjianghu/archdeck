/**
 * 草图的画布编辑（§6.15，ADR-0024）：新建设计 → 加层 → 加两个模块 → 连一条关系 → 保存 → 文件内容正确 → 刷新一致 → 「交给 AI」含改动摘要；
 * 改 ID（父不变的移动）的级联与确认、撤销 / 重做、文件在外部改动后重新加载并重放。
 * 设计目录建在真实的 model/h5p-arch-desk/designs/ 下，结束后删掉；指纹 owned.json 与拦截记录 ledger.jsonl 结束后恢复。
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { parse } from 'yaml'
import { graphNode, openDesk, restoreOwned } from './helpers'

const PROJECT = path.resolve(import.meta.dirname, '../model/h5p-arch-desk')
const GOV = path.join(PROJECT, 'governance')
const OWNED = path.join(GOV, 'owned.json')
const LEDGER = path.join(GOV, 'ledger.jsonl')

test.describe.configure({ mode: 'serial' })
test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

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

/** 从一个节点的连线柄拖到另一个节点中心（Vue Flow connect） */
async function dragConnect(page: Page, from: string, to: string) {
  const handle = graphNode(page, from).locator('.edit-handle')
  const a = (await handle.boundingBox())!
  const b = (await graphNode(page, to).boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.mouse.up()
}

test('SK-6–SK-11 主路径：新建设计（缺省空草图）→ 加层 → 加两个模块 → 连关系 → 保存 → 文件正确 → 刷新一致 → 交给 AI 含改动摘要', async ({ page }) => {
  const box = sandbox('zz-e2e-edit')
  try {
    await openDesk(page, '/p/h5p-arch-desk')
    await page.getByRole('button', { name: '新建设计' }).click()
    const dialog = page.getByRole('dialog', { name: '新建设计' })
    await dialog.locator('input[name="design-id"]').fill('zz-e2e-edit')
    await dialog.locator('input[name="design-name"]').fill('E2E 编辑')
    await expect(dialog.getByLabel('空草图')).toBeChecked()
    await dialog.getByRole('button', { name: '创建并编辑草图' }).click()
    await expect(page).toHaveURL(/\/d\/zz-e2e-edit\/sketch/)
    await expect(page.locator('.edit-bar .title')).toContainText('编辑草图：E2E 编辑')
    expect(parse(fs.readFileSync(path.join(box.dir, 'sketch.yaml'), 'utf8')).sketch).toEqual({ id: 'zz-e2e-edit', lifetime: 'until-implemented', modules: [] })

    // 加层：末尾的插入条
    const bands = page.locator('.vue-flow__node-band')
    const before = await bands.count()
    await page.locator('.insert-slot.layer .add').last().click()
    await page.locator('.inline-name input.name').fill('Edge')
    await page.keyboard.press('Enter')
    await expect(bands).toHaveCount(before + 1)
    await expect(page.locator('[data-testid="layer-form"]')).toContainText('edge')

    // 加两个模块：这一层的「+ 模块」
    for (const name of ['Alpha', 'Beta']) {
      await graphNode(page, 'insert:module:edge').locator('.add').click()
      await page.locator('.inline-name input.name').fill(name)
      await page.keyboard.press('Enter')
      await expect(page.locator('[data-testid="module-form"]')).toContainText(`edge.${name.toLowerCase()}`)
    }

    // 下钻到这一层，从 Alpha 的连线柄拖到 Beta
    await graphNode(page, 'edge').dblclick()
    await expect(graphNode(page, 'edge.alpha')).toBeVisible()
    await dragConnect(page, 'edge.alpha', 'edge.beta')
    const connect = page.getByRole('dialog', { name: '新建关系' })
    await connect.locator('input[name="rel-description"]').fill('E2E 连线')
    await connect.getByRole('button', { name: '连上' }).click()
    await expect(page.locator('[data-testid="relation-form"]')).toContainText('rel.alpha-beta')
    await expect(page.locator('[data-testid="edit-validation"]')).toContainText('校验通过')
    await expect(page.locator('[data-testid="edit-check"]')).toContainText('实现后将有')

    // 保存：整份写回，文件内容与操作一致
    await page.locator('.edit-bar').getByRole('button', { name: '保存' }).click()
    await expect(page.locator('.edit-bar .note')).toHaveText('已保存')
    const saved = parse(fs.readFileSync(path.join(box.dir, 'sketch.yaml'), 'utf8')).sketch
    expect(saved.modules).toEqual([
      {
        id: 'edge',
        name: 'Edge',
        kind: 'layer',
        order: expect.any(Number),
        children: [
          { id: 'edge.alpha', name: 'Alpha' },
          { id: 'edge.beta', name: 'Beta' },
        ],
      },
    ])
    expect(saved.relations).toEqual([{ id: 'rel.alpha-beta', from: 'edge.alpha', to: 'edge.beta', type: 'calls', description: 'E2E 连线' }])
    await expect(page.locator('.edit-bar .dot')).toHaveCount(0)

    // 刷新后一致：不在编辑态，草图照样画出这一层、两个模块与一条边
    await page.goto('./#/p/h5p-arch-desk/d/zz-e2e-edit/sketch?level=edge')
    await page.reload()
    await expect(page.locator('.edit-bar').getByRole('button', { name: '编辑' })).toBeVisible()
    await expect(graphNode(page, 'edge.alpha')).toBeVisible()
    await expect(graphNode(page, 'edge.beta')).toBeVisible()
    await expect(page.locator('.vue-flow__edge')).toHaveCount(1)

    // 交给 AI：指令附本次改动摘要（草图从没提交过，全部算新增）
    await page.locator('.design-bar .hand').click()
    await expect(page.locator('.design-bar .hand')).toHaveText('已复制指令')
    const prompt = await page.evaluate<string>('navigator.clipboard.readText()')
    expect(prompt).toContain('## 本次改动（草图相对上一次提交）')
    expect(prompt).toContain('新增模块「edge.alpha」')
    expect(prompt).toContain('新增关系「rel.alpha-beta」')
  } finally {
    box.restore()
  }
})

const SKETCH = `# E2E 的草图：保留这行注释
sketch:
  id: zz-e2e-mv
  modules:
    - id: edge   # 这一层
      name: Edge
      kind: layer
      order: 9
      responsibility: e
      children:
        - id: edge.alpha
          name: Alpha
          responsibility: a
          children:
            - { id: edge.alpha.deep, name: Deep, responsibility: d }
        - { id: edge.beta, name: Beta, responsibility: b }
  relations:
    - { id: rel.deep-beta, from: edge.alpha.deep, to: edge.beta, type: calls }
`

test('X7d、X7g、X7i：改 ID（父不变的移动）级联到后代并确认；撤销 / 重做；文件在外部改动后重新加载并重放，保存保留注释', async ({ page }) => {
  const box = sandbox('zz-e2e-mv')
  try {
    fs.mkdirSync(box.dir, { recursive: true })
    fs.writeFileSync(path.join(box.dir, 'design.yaml'), 'design:\n  name: E2E 移动\n  status: draft\n')
    fs.writeFileSync(path.join(box.dir, 'sketch.yaml'), SKETCH)
    await openDesk(page, '/p/h5p-arch-desk/d/zz-e2e-mv/sketch?level=edge&sel=m:edge.alpha&edit=1')
    const form = page.locator('[data-testid="module-form"]')
    await expect(form).toContainText('edge.alpha')

    // 改 ID：只改短名 → 二次确认列出级联
    await form.locator('input[name="module-id"]').fill('alfa')
    await form.locator('input[name="module-id"]').press('Enter')
    const confirm = page.getByRole('dialog', { name: /移动会改 ID/ })
    await expect(confirm).toContainText('edge.alpha.deep → edge.alfa.deep')
    await confirm.getByRole('button', { name: '移动' }).click()
    await expect(form.locator('h3')).toContainText('edge.alfa')
    await expect(graphNode(page, 'edge.alfa')).toBeVisible()

    // 撤销 / 重做：选中跟着 ID 回去、再过来
    await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('ControlOrMeta+z')
    await expect(graphNode(page, 'edge.alpha')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(graphNode(page, 'edge.alfa')).toBeVisible()

    // 文件在外部改动：编辑会话标为已过时；重新加载并重放后保存，外部的改动与原注释都在
    fs.writeFileSync(path.join(box.dir, 'sketch.yaml'), `${SKETCH}# 外部追加的注释\n`)
    await expect(page.locator('.edit-bar .stale')).toContainText('文件已在外部改动')
    await page.locator('.edit-bar .stale').getByRole('button', { name: '重新加载并重放' }).click()
    await expect(page.locator('.edit-bar .note')).toHaveText('已重放到新文件上')
    await page.locator('.edit-bar').getByRole('button', { name: '保存' }).click()
    await expect(page.locator('.edit-bar .note')).toHaveText('已保存')
    const text = fs.readFileSync(path.join(box.dir, 'sketch.yaml'), 'utf8')
    expect(text).toContain('# E2E 的草图：保留这行注释')
    expect(text).toMatch(/- id: edge +# 这一层/)
    expect(text).toContain('# 外部追加的注释')
    const s = parse(text).sketch
    expect(s.modules[0].children.map((m: { id: string }) => m.id)).toEqual(['edge.alfa', 'edge.beta'])
    expect(s.modules[0].children[0].children[0].id).toBe('edge.alfa.deep')
    expect(s.relations[0]).toMatchObject({ id: 'rel.deep-beta', from: 'edge.alfa.deep' })
  } finally {
    box.restore()
  }
})

test('E-1：从当前版本点「编辑骨架」进入持久草图的编辑态；版本切换里选「骨架 · 持久草图」后画布只有骨架的实体（同一个视图组件换版本也要重建）', async ({
  page,
}) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await page.getByRole('button', { name: '编辑骨架' }).click()
  await expect(page).toHaveURL(/\/p\/h5p-arch-desk\/i\/skeleton/)
  await expect(page.locator('.edit-bar .title')).toContainText('编辑草图：骨架')
  await expect(page.locator('.insert-slot').first()).toBeVisible()
  await page.locator('.edit-bar').getByRole('button', { name: '退出编辑' }).click()
  await expect(page.locator('.edit-bar').getByRole('button', { name: '编辑' })).toBeVisible()

  // 回到当前版本，再经版本切换选持久草图
  await page.locator('select[aria-label="切换版本"]').selectOption('')
  await expect(page.locator('.intent-bar')).toHaveCount(0)
  // 当前视图的模型索引里有没有这个模块（加载中为 null）
  const has = (id: string) =>
    page.evaluate(
      x => (globalThis as unknown as { __desk?: { index: { value: { modules: Map<string, unknown> } | null } } }).__desk?.index.value?.modules.has(x) ?? null,
      id,
    )
  await expect.poll(() => has('state.desk.edit')).toBe(true)
  await page.locator('select[aria-label="切换版本"]').selectOption('i:skeleton')
  await expect(page.locator('.intent-bar')).toContainText('持久草图')
  await expect.poll(() => has('state.desk.edit')).toBe(false)
  await expect.poll(() => has('state.desk')).toBe(true)
  await expect(page.locator('.vue-flow__node-band')).toHaveCount(4)
})
