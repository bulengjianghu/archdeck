/**
 * 人确认层的核心路径（§6.11，RV-1–RV-4）：确认一个模块 → reviewed.yaml 多一条 → 改描述的职责一行（模拟 AI 重新生成）→
 * 树与面板出现「需复核」且差异只有那一行、返工清单多一条 → 复核并确认后消失、记录仍是一条。
 * 直接改真实的 model/h5p-arch-desk/，结束时原样恢复（其他 spec 只读这份描述，临时改一行职责不影响它们的断言）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { openDesk } from './helpers'

const MODEL = path.resolve(import.meta.dirname, '../model/h5p-arch-desk')
const LAYERS = path.join(MODEL, 'modules/layers.yaml')
const REVIEWED = path.join(MODEL, 'reviewed.yaml')
/** 第二级、非核心的模块：不在自举样本（核心模块）里，确认后文件应多一条 */
const MODULE = 'access.writer'
const OLD_LINE = '只收同源的 JSON POST。'
const NEW_LINE = '只收同源的 JSON POST（E2E 临时改的一行）。'

test('确认 → 改职责一行 → 需复核（差异只有那一行）→ 复核并确认（Z1、Z3）', async ({ page }) => {
  const layers0 = fs.readFileSync(LAYERS, 'utf8')
  const reviewed0 = fs.existsSync(REVIEWED) ? fs.readFileSync(REVIEWED, 'utf8') : null
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

    // 确认：文件多一条，标题旁「已确认 <日期>」
    await panel.getByLabel('确认说明').fill('E2E 确认')
    await panel.getByRole('button', { name: '确认', exact: true }).click()
    await expect.poll(count).toBe(before + 1)
    await expect(badge).toHaveText(/^已确认 \d{4}-\d{2}-\d{2}$/)
    const hash1 = entry()
    expect(hash1).toBeTruthy()
    expect(fs.readFileSync(REVIEWED, 'utf8')).toContain('note: E2E 确认')
    await expect(treeRow.locator('.tag.reviewed')).toHaveText('✓')

    // AI 重新生成：职责改一行 → 需复核，差异只有那一行
    fs.writeFileSync(LAYERS, layers0.replace(OLD_LINE, NEW_LINE))
    await expect(badge).toHaveText('需复核')
    await expect(treeRow.locator('.tag.stale')).toHaveText('需复核')
    await expect(page.locator('.nav-tree .tools')).toContainText('需复核 1')
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
  }
})
