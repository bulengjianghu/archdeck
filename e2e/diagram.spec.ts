/**
 * 对话里的机制图（第二十一轮波 4 T4.0，DA-6，DL-40–DL-43）：假 agent 替身按「#名字」挑剧本（diagram / diagram-ask / diagram-bad）。
 * 草图里：说「画一张图讲拆分后怎么运作」→ 卡上一张图，单击图里的框画布选中，存为设计说明后预览里有图；不合格的图只出文字与拒绝原因。
 * 当前版本上：图里单击模块，画布选中（与图解同一机制），资料区不动。
 * 草图用例在真实的 model/h5p-arch-desk/designs/ 下建临时设计，结束后删掉并撤销指纹与拦截记录里的痕迹（同 sketch-dialogue.spec）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { activeTab, graphNode, openDesk, query, sketchOn } from './helpers'

const PROJECT = path.resolve(import.meta.dirname, '../model/h5p-arch-desk')

const dock = (page: Page) => page.getByRole('complementary', { name: '资料区' })
const dialogue = (page: Page) => dock(page).getByTestId('dialogue')
const input = (page: Page) => dialogue(page).getByRole('textbox', { name: '对话输入' })
async function say(page: Page, text: string) {
  await input(page).fill(text)
  await input(page).press('Enter')
}

test('DL-40–DL-43 草图里：画一张图讲拆分后怎么运作——卡上可见、单击图里的框画布选中、存为设计说明后预览里有图', async ({ page }) => {
  const design = 'zz-e2e-w4-diagram'
  const { restore } = await sketchOn(page, design)
  try {
    await say(page, '#diagram 画一张图讲拆分后怎么运作')
    const msg = dialogue(page).getByTestId('msg-agent')
    await expect(msg.getByTestId('answer-card')).toBeVisible()
    const fig = msg.getByTestId('diagram')
    await expect(fig).toBeVisible()
    await expect(fig.getByTestId('diagram-caption')).toHaveText('拆分后：左边受理、右边落下，只经一条命令往来')
    // 没有改动块：不出提议卡，草图不变
    await expect(dialogue(page).getByTestId('proposal-card')).toHaveCount(0)
    const frame = fig.frameLocator('iframe')
    const boxes = frame.locator('svg g[data-arch]')
    await expect(boxes).toHaveCount(2)
    const id = (await boxes.nth(1).getAttribute('data-arch'))!
    expect(id).toMatch(/^state\.desk\./)
    // 单击图里的框：当前张上那个框被选中，锚点条带上它；资料区不动
    await boxes.nth(1).locator('rect').click()
    await expect(graphNode(page, id).locator('.sk-node')).toHaveClass(/selected/)
    await expect(dialogue(page).getByTestId('anchor-bar')).toContainText('当前张 DeskState · ')
    await expect(activeTab(page, 0)).toContainText('对话')

    // 存为设计说明：图随文字写进 notes/，预览里有图
    await msg.getByTestId('save-note').click()
    const note = dock(page).getByTestId('note-doc')
    // 存好后要等重新加载带回设计说明清单：多 worker 并行时开发服务器读草图版本一次就要 5–7 s，按 agent 一轮的预算等（同 sketch-dialogue）
    await expect(note).toBeVisible({ timeout: 25_000 })
    await expect(note.getByTestId('diagram-caption')).toHaveText('拆分后：左边受理、右边落下，只经一条命令往来')
    await expect(note.getByTestId('diagram').frameLocator('iframe').locator('svg g[data-arch]')).toHaveCount(2)
    const files = fs.readdirSync(path.join(PROJECT, 'designs', design, 'notes'))
    expect(files).toHaveLength(1)
    const text = fs.readFileSync(path.join(PROJECT, 'designs', design, 'notes', files[0]), 'utf8')
    expect(text).toContain('```arch-diagram 拆分后：左边受理、右边落下，只经一条命令往来\n<svg')
    // 图块不是描述：不落 explainers/
    expect(fs.existsSync(path.join(PROJECT, 'designs', design, 'explainers'))).toBe(false)
  } finally {
    await restore()
  }
})

test('DL-41 不合格的图（脚本、外链、不存在的模块）：整块拒绝，卡上只有文字与拒绝原因', async ({ page }) => {
  const { restore } = await sketchOn(page, 'zz-e2e-w4-diagram-bad')
  try {
    await say(page, '#diagram-bad 画一张图')
    const msg = dialogue(page).getByTestId('msg-agent')
    await expect(msg.getByTestId('answer-card')).toContainText('文字照常显示')
    const rejected = msg.getByTestId('diagram-rejected')
    await expect(rejected).toContainText('图被拒')
    await expect(rejected).toContainText('<script>')
    await expect(rejected).toContainText('https://example.com/x.png')
    await expect(rejected).toContainText('no.such.module')
    await expect(msg.getByTestId('diagram')).toHaveCount(0)
    await expect(msg.locator('iframe')).toHaveCount(0)
  } finally {
    await restore()
  }
})

test('DL-42 当前版本上：图里单击模块，画布选中（与图解同一机制），资料区不动', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sel=m:state')
  await dock(page).locator('.module-doc [data-action="discuss"]').click()
  await say(page, '#diagram-ask 画一张图讲它怎么运作')
  const fig = dialogue(page).getByTestId('diagram')
  await expect(fig).toBeVisible()
  const frame = fig.frameLocator('iframe')
  await expect(frame.locator('g[data-arch="state"]')).toHaveCount(1)
  const child = frame.locator('g[data-arch]').nth(1)
  const id = (await child.getAttribute('data-arch'))!
  expect(id).toMatch(/^state\./)
  await child.locator('rect').click()
  await expect.poll(() => query(page).get('sel')).toBe(`m:${id}`)
  await expect(activeTab(page, 0)).toContainText('对话')
})
