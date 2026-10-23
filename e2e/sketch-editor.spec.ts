/**
 * 草图画布（§6.16，SK-12–SK-21，ADR-0025）：新建设计选挂载点 → 底稿按挂载点从基线复制 → 合并两个 → 拖位置 → 连关系 → 保存 →
 * 文件含 mount / layout / from → 刷新原样；持久草图（骨架）打开即草图画布，退出回到进入前的版本。
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
  const handle = graphNode(page, from).locator('.sk-out')
  const a = (await handle.boundingBox())!
  const b = (await graphNode(page, to).boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.mouse.up()
}

/** 按住节点拖动 (dx, dy) 像素 */
async function dragBy(page: Page, id: string, dx: number, dy: number) {
  const b = (await graphNode(page, id).locator('.name').boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 10 })
  await page.mouse.up()
}

const sketchFile = (dir: string, mount: string) => parse(fs.readFileSync(path.join(dir, `sketches/${mount}.yaml`), 'utf8')).sketch

test('SK-14–SK-19 主路径：新建设计选挂载点 → 底稿复制 → 合并两个 → 拖位置 → 连关系 → 保存 → 文件含 mount / layout / from → 刷新原样', async ({ page }) => {
  const box = sandbox('zz-e2e-sketch')
  try {
    await openDesk(page, '/p/h5p-arch-desk')
    await page.getByRole('button', { name: '新建设计' }).click()
    const dialog = page.getByRole('dialog', { name: '新建设计' })
    await dialog.locator('input[name="design-id"]').fill('zz-e2e-sketch')
    await dialog.locator('input[name="design-name"]').fill('E2E 草图')
    await dialog.locator('select[name="design-mount"]').selectOption('state.desk')
    await dialog.getByRole('button', { name: '创建并打开草图' }).click()
    await expect(page).toHaveURL(/\/d\/zz-e2e-sketch\/sketch/)
    await expect(page.locator('.sketch-canvas')).toBeVisible()

    // 底稿：挂载点 DeskState 的一层从基线复制，带一次初始布局，不带职责文字
    const seed = sketchFile(box.dir, 'state.desk')
    expect(seed).toMatchObject({ id: 'zz-e2e-sketch', mount: 'state.desk' })
    const ids: string[] = seed.modules.map((m: { id: string }) => m.id)
    expect(ids.length).toBeGreaterThan(3)
    expect(seed.modules.every((m: { responsibility?: string }) => !m.responsibility)).toBe(true)
    expect(Object.keys(seed.layout.modules)).toEqual(expect.arrayContaining(ids))
    for (const id of ids) await expect(graphNode(page, id)).toBeVisible()
    await expect(page.locator('.sk-crumbs')).toContainText('DeskState')
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
    await expect(page.locator('.edit-bar .dot')).toHaveCount(1)

    // 拖位置：一步，可撤销
    const before = (await graphNode(page, 'state.desk.session').boundingBox())!
    await dragBy(page, 'state.desk.session', 160, 90)
    await expect.poll(async () => (await graphNode(page, 'state.desk.session').boundingBox())!.x).toBeGreaterThan(before.x + 100)

    // 连关系：从连线柄拖到另一个节点，选类型 + 一句说明
    await dragConnect(page, 'state.desk.session', c)
    const connect = page.getByRole('dialog', { name: '新建关系' })
    await connect.locator('input[name="rel-description"]').fill('E2E 连线')
    await connect.getByRole('button', { name: '连上' }).click()
    await expect(page.locator('.sk-edge-label', { hasText: 'E2E 连线' })).toBeVisible()

    // 保存（⌘S）：整个设计写回；文件含 mount / layout / from
    await page.locator('.vue-flow__pane').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('ControlOrMeta+s')
    await expect(page.locator('.sk-notice')).toContainText('已保存')
    await expect(page.locator('.edit-bar .dot')).toHaveCount(0)
    const saved = sketchFile(box.dir, 'state.desk')
    expect(saved.mount).toBe('state.desk')
    const session = saved.modules.find((m: { id: string }) => m.id === 'state.desk.session')
    expect(session).toMatchObject({ name: '编辑会话', from: [a, b] })
    expect(saved.modules.some((m: { id: string }) => m.id === a)).toBe(false)
    expect(saved.layout.modules['state.desk.session'].x).toBeGreaterThan(seed.layout.modules[c].x - 2000)
    expect(saved.relations).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: 'state.desk.session', to: c, type: 'calls', description: 'E2E 连线' })]),
    )
    // 合并写入的下一层与推出结果相同：不写文件（X20、T1 裁决 5）
    expect(fs.existsSync(path.join(box.dir, 'sketches/state.desk.session.yaml'))).toBe(false)
    const pos = saved.layout.modules['state.desk.session']

    // 刷新原样：位置、合并结果与关系都在
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

    // 下钻：合并结果的下一层由血缘推出，来源成为它的子模块；面包屑返回
    await graphNode(page, 'state.desk.session').dblclick()
    await expect(graphNode(page, `state.desk.session.${a.split('.').pop()}`)).toBeVisible()
    await expect(page.locator('.sk-crumbs')).toContainText('编辑会话')
    await page.locator('.sk-crumbs .crumb', { hasText: 'DeskState' }).click()
    await expect(graphNode(page, 'state.desk.session')).toBeVisible()
  } finally {
    box.restore()
  }
})

test('E-1：从当前版本点「编辑骨架」打开持久草图即进入草图画布（层画成节点）；退出回到进入前的版本；版本切换选「骨架 · 持久草图」后索引只有骨架的实体', async ({
  page,
}) => {
  await openDesk(page, '/p/h5p-arch-desk')
  await page.getByRole('button', { name: '编辑骨架' }).click()
  await expect(page).toHaveURL(/\/p\/h5p-arch-desk\/i\/skeleton/)
  await expect(page.locator('.sketch-canvas')).toBeVisible()
  await expect(page.locator('.edit-bar .title')).toContainText('编辑草图：骨架')
  await expect(page.locator('.sk-node.layer')).toHaveCount(4)
  await page.locator('.edit-bar').getByRole('button', { name: '退出' }).click()
  await expect(page).not.toHaveURL(/\/i\/skeleton/)
  await expect(page.locator('.sketch-canvas')).toHaveCount(0)

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
  await expect(page.locator('.sk-node.layer')).toHaveCount(4)
})
