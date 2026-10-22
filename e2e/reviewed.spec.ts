/**
 * 人确认层的核心路径（§6.11，RV-1–RV-4）：确认一个模块 → reviewed.yaml 多一条 → 改描述的职责一行（模拟内容被改动）→
 * 树与面板出现「需复核」且差异只有那一行、返工清单多一条 → 复核并确认后消失、记录仍是一条。
 * 直接改真实的 model/h5p-arch-desk/，结束时原样恢复（其他 spec 只读这份描述，临时改一行职责不影响它们的断言）。
 * 第二级模块的职责写在骨架 intent/skeleton.yaml（X1）；页面写入会更新指纹 governance/owned.json（X6）、追加拦截记录 governance/ledger.jsonl（Z6），一并恢复。
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { openDesk } from './helpers'

const MODEL = path.resolve(import.meta.dirname, '../model/h5p-arch-desk')
const LAYERS = path.join(MODEL, 'intent/skeleton.yaml')
const OWNED = path.join(MODEL, 'governance/owned.json')
const REVIEWED = path.join(MODEL, 'reviewed.yaml')
/** 每次确认写入追加一行拦截记录（Z6），一并恢复 */
const LEDGER = path.join(MODEL, 'governance/ledger.jsonl')
/** 第二级、非核心的模块：不在自举样本（核心模块）里，确认后文件应多一条 */
const MODULE = 'access.writer'
const OLD_LINE = '只收同源的 JSON POST。'
const NEW_LINE = '只收同源的 JSON POST（E2E 临时改的一行）。'

test('确认 → 改职责一行 → 需复核（差异只有那一行）→ 复核并确认（Z1、Z3）', async ({ page }) => {
  const layers0 = fs.readFileSync(LAYERS, 'utf8')
  const reviewed0 = fs.existsSync(REVIEWED) ? fs.readFileSync(REVIEWED, 'utf8') : null
  const owned0 = fs.existsSync(OWNED) ? fs.readFileSync(OWNED, 'utf8') : null
  const ledger0 = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8') : null
  expect(layers0).toContain(OLD_LINE)
  const count = () => (fs.readFileSync(REVIEWED, 'utf8').match(/^ {2}- module: /gm) ?? []).length
  const entry = () => /module: access\.writer\n\s+at: [^\n]+\n\s+hash: (\S+)/.exec(fs.readFileSync(REVIEWED, 'utf8'))?.[1]
  try {
    await openDesk(page, `/p/h5p-arch-desk?sel=m:${MODULE}`)
    const panel = page.locator('.panel')
    const badge = panel.locator('.badge.review')
    const treeRow = page.locator(`.nav-tree [data-id="${MODULE}"]`)
    await expect(badge).toHaveText('未确认')
    const before = count()
    // 描述里可能已有别的需复核模块（如合并后指纹变了的），只断言本次多出一个
    const tools = page.locator('.nav-tree .tools')
    const stale0 = (await tools.count()) ? Number(/需复核 (\d+)/.exec(await tools.innerText())?.[1] ?? 0) : 0

    // 确认：文件多一条，标题旁「已确认 <日期>」
    await panel.getByLabel('确认说明').fill('E2E 确认')
    // 面板里可能还有名为「确认」的模块链接（模型层「确认」子模块），按钮在确认表单里
    await panel.locator('form').getByRole('button', { name: '确认', exact: true }).click()
    await expect.poll(count).toBe(before + 1)
    await expect(badge).toHaveText(/^已确认 \d{4}-\d{2}-\d{2}$/)
    await expect(badge).toHaveAttribute('title', /已确认的内容与代码是否一致由代码事实判断/)
    const hash1 = entry()
    expect(hash1).toBeTruthy()
    // 确认写入记一行拦截记录，来源 page（Z6）
    const last = fs.readFileSync(LEDGER, 'utf8').trim().split('\n').at(-1)!
    expect(JSON.parse(last)).toMatchObject({ tool: 'reviewed', origin: 'page', modules: 1 })
    expect(fs.readFileSync(REVIEWED, 'utf8')).toContain('note: E2E 确认')
    await expect(treeRow.locator('.tag.reviewed')).toHaveText('✓')

    // 职责改一行 → 需复核，差异只有那一行
    fs.writeFileSync(LAYERS, layers0.replace(OLD_LINE, NEW_LINE))
    await expect(badge).toHaveText('需复核')
    await expect(treeRow.locator('.tag.stale')).toHaveText('需复核')
    await expect(tools).toContainText(`需复核 ${stale0 + 1}`)
    const diff = panel.locator('.diff')
    await expect(diff.locator('dt')).toHaveText(['职责'])
    await expect(diff.locator('.change')).toHaveCount(2)
    await expect(diff.locator('.change.removed')).toContainText(OLD_LINE)
    await expect(diff.locator('.change.added')).toContainText(NEW_LINE)
    await expect(panel).toContainText('自上次确认以来的改动')

    // 返工清单多一条「需复核」
    await page.getByRole('tab', { name: /问题/ }).click()
    await expect(page.locator('.nav-tree')).toContainText('需复核：描述写入')
    await page.getByRole('tab', { name: '模块' }).click()

    // 复核并确认：标记消失，记录仍是一条、hash 更新
    await panel.getByRole('button', { name: '复核并确认' }).click()
    await expect(badge).toHaveText(/^已确认/)
    await expect(treeRow.locator('.tag.stale')).toHaveCount(0)
    await expect(panel).not.toContainText('自上次确认以来的改动')
    await expect.poll(count).toBe(before + 1)
    expect(entry()).not.toBe(hash1)
  } finally {
    fs.writeFileSync(LAYERS, layers0)
    if (reviewed0 === null) fs.rmSync(REVIEWED, { force: true })
    else fs.writeFileSync(REVIEWED, reviewed0)
    if (owned0 === null) fs.rmSync(OWNED, { force: true })
    else fs.writeFileSync(OWNED, owned0)
    if (ledger0 === null) fs.rmSync(LEDGER, { force: true })
    else fs.writeFileSync(LEDGER, ledger0)
  }
})
