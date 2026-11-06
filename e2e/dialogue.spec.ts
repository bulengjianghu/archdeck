/**
 * 对话标签（第二十一轮波 1，DA-1–DA-5、DA-7；验收草案 13、14）：开发服务器的 agent 换成假 agent 替身（playwright.config 的 ARCH_AGENT_COMMAND），
 * 剧本按输入里的「#名字」挑（scripts/agent/scripts/）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { graphNode, LOAD_BUDGET, openDesk, query } from './helpers'

const dock = (page: Page) => page.getByRole('complementary', { name: '资料区' })
const dialogue = (page: Page) => dock(page).getByTestId('dialogue')
const input = (page: Page) => dialogue(page).getByRole('textbox', { name: '对话输入' })
async function say(page: Page, text: string) {
  await input(page).fill(text)
  await input(page).press('Enter')
}
/** 第二十轮版式：身份卡在选中抽屉里；事实卡在辅助栏理解页页顶——两处名称行都有「讨论 ›」，用理解页的那个 */
const discuss = (page: Page) => dock(page).locator('.module-doc [data-action="discuss"]')

test('验收 13：点「讨论 ›」打开对话；假 agent 回带引用的问答卡，单击引用画布定位；换选中锚点条变、转录不变', async ({ page }) => {
  test.setTimeout(120_000)
  await openDesk(page, '/p/h5p-arch-desk?sel=m:state')
  await discuss(page).click()
  await expect(dock(page).locator('.tab.on')).toContainText('对话')
  await expect(dialogue(page).getByTestId('anchor-bar')).toContainText('视图状态层')
  await expect(dialogue(page).getByTestId('mode-badge')).toHaveText('只问')

  await say(page, '为什么这样分？')
  const card = dialogue(page).getByTestId('answer-card')
  await expect(card).toBeVisible({ timeout: LOAD_BUDGET })
  // DA-3：引用原文由架构台填；推断段标「推断」
  await expect(card.getByTestId('cite')).toHaveAttribute('data-module', 'state')
  await expect(card.getByTestId('inferred')).toBeVisible()

  // DA-2：换选中，锚点条跟着变，转录不变
  const transcript = await dialogue(page).getByTestId('dialogue-log').innerText()
  await graphNode(page, 'model').click()
  await expect.poll(() => query(page).get('sel')).toBe('m:model')
  await expect(dialogue(page).getByTestId('anchor-bar')).toContainText('模型层')
  expect(await dialogue(page).getByTestId('dialogue-log').innerText()).toBe(transcript)

  // 单击引用：画布回到被引用的模块
  // 收尾复跑：负载下别的用例改描述，重新加载让卡片重绘、按钮被换掉，单击一直重试到用例超时——短超时单击、看选中，按 toPass 重试
  await expect(async () => {
    await card.getByTestId('cite').click({ timeout: 3_000 })
    await expect.poll(() => query(page).get('sel'), { timeout: 3_000 }).toBe('m:state')
  }).toPass({ timeout: LOAD_BUDGET })
})

test('停止按钮终止假 agent 的延迟剧本：这一轮什么都不落，可再发', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sel=m:state')
  await discuss(page).click()
  await say(page, '#timeout 想得久一点')
  // 收尾 S0：等回答卡与停止的预算与 sketch-dialogue 同口径（LOAD_BUDGET），负载下服务端读描述就要好几秒
  await expect(dialogue(page).getByTestId('msg-live')).toContainText('AI 正在回答', { timeout: LOAD_BUDGET })
  await dialogue(page).getByTestId('dialogue-stop').click()
  await expect(dialogue(page).getByTestId('msg-stopped')).toContainText('已停止', { timeout: LOAD_BUDGET })
  await expect(dialogue(page).getByTestId('msg-live')).toHaveCount(0)
  await expect(dialogue(page).getByTestId('dialogue-stop')).toHaveCount(0)
  await expect(dialogue(page).getByTestId('msg-agent')).toHaveCount(0)
  // 停止后可再发
  await say(page, '再问一次')
  await expect(dialogue(page).getByTestId('answer-card')).toBeVisible({ timeout: LOAD_BUDGET })
})

test('崩溃出错误卡，会话不受影响', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sel=m:state')
  await discuss(page).click()
  await say(page, '#crash 试试')
  await expect(dialogue(page).getByTestId('msg-error')).toContainText('崩溃')
  await say(page, '再来')
  await expect(dialogue(page).getByTestId('answer-card')).toBeVisible()
})

test('验收 7（梳理卡部分）：贴图后假 agent 回梳理卡——照片与卡并排，四组各有条目，不确定标记可见', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?sel=m:state')
  await discuss(page).click()
  // 1×1 的 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  await dialogue(page).getByTestId('dialogue-file').setInputFiles({ name: 'whiteboard.png', mimeType: 'image/png', buffer: png })
  await expect(dialogue(page).locator('.pending img')).toHaveCount(1)
  await say(page, '#digest 这是白板上的图')
  const digest = dialogue(page).getByTestId('digest')
  await expect(digest).toBeVisible()
  await expect(digest.getByTestId('digest-photo')).toHaveCount(1)
  for (const g of ['matched', 'mismatched', 'extra', 'missing']) await expect(digest.locator(`[data-group="${g}"] li`)).not.toHaveCount(0)
  await expect(digest.getByTestId('uncertain')).toBeVisible()
  // 并排：照片在卡片左侧
  const [photo, cardBox] = [await digest.locator('.photos').boundingBox(), await digest.locator('.card').boundingBox()]
  expect(photo!.x + photo!.width).toBeLessThanOrEqual(cardBox!.x + 1)
})

test.describe('验收 14：重讲', () => {
  // 改的是真实描述目录里的题解与讲法要求：用 h5player 的「领域端口」（其他用例不读它的题解），结束原样写回
  const dir = path.resolve(import.meta.dirname, '../model/h5player')
  const html = path.join(dir, 'explainers/domain.ports.html')
  const notes = path.join(dir, 'explainers/domain.ports.notes.md')
  const snapshot = () => Object.fromEntries(fs.readdirSync(path.join(dir, 'modules')).map(f => [f, fs.readFileSync(path.join(dir, 'modules', f), 'utf8')]))
  let original = ''
  test.beforeEach(() => {
    original = fs.readFileSync(html, 'utf8')
  })
  test.afterEach(() => {
    fs.writeFileSync(html, original)
    fs.rmSync(notes, { force: true })
  })

  test('重讲后题解更新、依据重盖，事实卡与骨架字段一字未动；含事实改动的产出整轮拒绝', async ({ page }) => {
    const yamlBefore = snapshot()
    await openDesk(page, '/p/h5player?level=domain&sel=m:domain.ports')
    const facts = dock(page).locator('.module-doc [data-sec="understand"]')
    await expect(facts).toBeVisible()
    const factsBefore = await facts.innerText()
    await discuss(page).click()
    await dialogue(page).getByRole('button', { name: '重讲', exact: true }).click()
    await expect(dialogue(page).getByTestId('mode-badge')).toHaveText('只动讲法')

    // 含事实改动：整轮拒绝，文件不动
    await say(page, '#renarrate-facts 顺手把职责改短')
    await expect(dialogue(page).getByTestId('renarrate-outcome')).toContainText('重讲被拒')
    expect(fs.readFileSync(html, 'utf8')).toBe(original)
    expect(fs.existsSync(notes)).toBe(false)

    await say(page, '把机制图的箭头方向改过来')
    await expect(dialogue(page).getByTestId('renarrate-outcome').last()).toContainText('题解已按要求重讲')
    const written = fs.readFileSync(html, 'utf8')
    expect(written).toContain('data-testid="renarrated"')
    expect(written).toMatch(/<meta name="arch-basis" content="v1 /)
    expect(fs.readFileSync(notes, 'utf8')).toContain('机制图的箭头从调用方指向被调方')

    // 题解在辅助栏里是新的；事实卡与骨架一字未动
    await dialogue(page).getByRole('button', { name: '看题解 ›' }).click()
    await expect(dock(page).frameLocator('iframe').getByTestId('renarrated')).toBeVisible()
    await expect.poll(() => facts.innerText()).toBe(factsBefore)
    expect(snapshot()).toEqual(yamlBefore)
  })
})
