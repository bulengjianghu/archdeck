/**
 * 草图里指定层（第二十一轮波 4 T4.R，DL-44，ADR-0063 修订节）：DeskState（state.desk）声明了分层——
 * AI 加一个框并用 setStratum 指定层，认可不再被「不属于任何一层」拦；人在选中面板的「层」字段指定同样解开。
 * 临时设计挂在真实的 model/h5p-arch-desk/designs/ 下，结束后删掉并撤销指纹与拦截记录里的痕迹。
 */
import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { graphNode, openSketchPanel, sketchOn } from './helpers'

const dock = (page: Page) => page.getByRole('complementary', { name: '资料区' })
const dialogue = (page: Page) => dock(page).getByTestId('dialogue')
const input = (page: Page) => dialogue(page).getByRole('textbox', { name: '对话输入' })
const cards = (page: Page) => dialogue(page).getByTestId('proposal-card')
async function round(page: Page, text: string) {
  const n = await cards(page).count()
  await input(page).fill(text)
  await input(page).press('Enter')
  await expect(cards(page)).toHaveCount(n + 1, { timeout: 25_000 })
  await expect(page.getByTestId('ai-editing')).toHaveCount(0)
}
const bar = (page: Page) => page.locator('.info-bar')
async function save(page: Page) {
  await bar(page).getByRole('button', { name: '保存' }).click()
  await expect(bar(page).locator('.dirty')).toHaveCount(0)
}
const NEW = 'state.desk.run-derive'

test('DL-44 AI 用 setStratum 给新框指定层：保存后草图文件写进层的成员，认可总览打开（不被「不属于任何一层」拦）', async ({ page }) => {
  test.setTimeout(90_000)
  const { restore, dir } = await sketchOn(page, 'zz-e2e-w4-stratum-ai', { goal: '波 4 T4.R' })
  try {
    await round(page, '#stratum-add 加一个运行派生，放进派生层')
    await expect(graphNode(page, NEW)).toBeVisible()
    await save(page)
    const text = fs.readFileSync(`${dir}/sketches/state.desk.yaml`, 'utf8')
    expect(text).toMatch(/- id: derive[\s\S]*?- state\.desk\.run-derive/)
    await bar(page).getByRole('button', { name: '认可', exact: true }).click()
    await expect(page.getByTestId('accept-dialog')).toBeVisible()
    await expect(page.getByTestId('accept-dialog').getByTestId('accept-item')).toContainText('运行派生')
  } finally {
    await restore()
  }
})

test('DL-44 没指定层时认可被拦并提示去「层」里指定；人在选中面板的「层」字段选了之后认可放行', async ({ page }) => {
  test.setTimeout(90_000)
  const { restore } = await sketchOn(page, 'zz-e2e-w4-stratum-human', { goal: '波 4 T4.R' })
  try {
    await round(page, '#stratum-bare 加一个运行派生')
    await save(page)
    await bar(page).getByRole('button', { name: '认可', exact: true }).click()
    await expect(page.getByTestId('accept-dialog')).toHaveCount(0)
    await expect(bar(page).getByRole('status')).toContainText('不属于任何一层')
    // 人：选中新框 → 面板「层」字段
    await graphNode(page, NEW).locator('.name').click()
    await openSketchPanel(page)
    const sel = page.locator('select[name="module-stratum"]')
    await expect(sel).toHaveValue('')
    await sel.selectOption('derive')
    await expect(sel).toHaveValue('derive')
    await save(page)
    await bar(page).getByRole('button', { name: '认可', exact: true }).click()
    await expect(page.getByTestId('accept-dialog')).toBeVisible()
  } finally {
    await restore()
  }
})
