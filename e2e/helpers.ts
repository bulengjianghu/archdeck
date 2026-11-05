/** E2E 公共步骤：打开项目视图并等画布布局完成（布局在 Worker 中异步完成） */
import fs from 'node:fs'
import path from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'

/** 打开 `#/p/...`（hash 路由），等结构图出现节点 */
export async function openDesk(page: Page, hashPath: string) {
  await page.goto(`./#${hashPath}`)
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
}

/** TB-6：打开导航顶部的项目菜单（版本、编辑骨架、新建设计、所有项目）；已打开时不动 */
export async function openProjectMenu(page: Page) {
  const btn = page.getByRole('button', { name: '项目菜单' })
  // 项目标题区在导航顶部，导航收起时（运行视角、资料区出现时）先展开
  const nav = page.getByRole('button', { name: '导航树', exact: true })
  if ((await nav.getAttribute('aria-pressed')) !== 'true') await nav.click()
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click()
  await expect(page.getByRole('menu', { name: '项目' })).toBeVisible()
}

/** TB-6：在项目菜单的版本下拉里切换版本（值同 VersionSwitcher：`<设计>/<轮次>`、`i:<草图>`、`c:<提交>`，空为当前版本） */
export async function switchVersion(page: Page, value: string) {
  await openProjectMenu(page)
  await page.locator('select[aria-label="切换版本"]').selectOption(value)
}

/** 等画布布局稳定：节点位置连续三次（约 0.75 s）不变才算稳定（首次适应只一次，WS-3；之后的展开、聚焦等仍可能挪动节点） */
export async function waitSettled(page: Page) {
  const node = page.locator('.vue-flow__node').first()
  let last = ''
  let same = 0
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await node.boundingBox())
        same = now === last ? same + 1 : 0
        last = now
        return same >= 3
      },
      { intervals: [250] },
    )
    .toBe(true)
}

/** L45：把图例的开关行设成开或关（开关行是 role=switch 的按钮，aria-checked 表状态） */
export async function setSwitch(toggle: Locator, on: boolean) {
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', String(on))
}

/** 收起图例（展开时叠在画布右上，会挡住那里的节点，L48），随后等布局稳定，悬停 / 点击才落在节点上 */
export async function collapseDisplay(page: Page) {
  const btn = page.locator('.display .head-btn')
  if ((await btn.getAttribute('aria-expanded')) === 'true') await btn.click()
  await waitSettled(page)
}

/** 当前地址的查询参数（hash 路由，参数在 # 之后） */
export function query(page: Page): URLSearchParams {
  const hash = new URL(page.url()).hash
  return new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
}

/** 结构图上的视图节点 */
export const graphNode = (page: Page, id: string) => page.locator(`.vue-flow__node[data-id="${id}"]`)

/**
 * 指纹门禁 governance/owned.json 的局部恢复：只把给出的路径（相对项目描述目录）恢复成快照里的指纹（快照里没有的删掉；
 * 给出的是前缀 `<目录>/` 时整组按快照处理），updatedAt 回到快照。各 spec 并行时都在写这个文件，整份恢复会把别的 spec 的临时写入写回去。
 */
export function restoreOwned(file: string, snapshot: string, paths: readonly string[]) {
  const was = JSON.parse(snapshot) as { updatedAt: string; files: Record<string, string> }
  const now = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof was
  const hit = (f: string) => paths.some(p => (p.endsWith('/') ? f.startsWith(p) : f === p))
  const files = Object.fromEntries(Object.entries(now.files).filter(([f]) => !hit(f)))
  for (const [f, h] of Object.entries(was.files)) if (hit(f)) files[f] = h
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
  fs.writeFileSync(file, `${JSON.stringify({ ...now, updatedAt: was.updatedAt, files: sorted }, null, 2)}\n`)
}

/** 属性栏核对卡（PC-2）收起时展开它；给了 data-sec 时再展开那个折叠的清单（PC-8） */
/** 第二十轮 §4：导航树是画布左缘的浮层抽屉——盖住画布左上的胶囊，看完树里的东西要操作画布前先收起 */
export async function closeNav(page: Page) {
  if (await page.locator('.nav-area').isVisible()) await page.getByRole('button', { name: '导航树', exact: true }).click()
}

/** 第二十轮 §4：选中面板缺省收起（运行视角自动收起，步骤节在辅助栏）——要动核对卡先把抽屉拉开 */
export async function openPropsDrawer(page: Page) {
  if (await page.locator('aside.props .panel').count()) return
  await page.locator('.props-toggle').click()
  await expect(page.locator('aside.props .panel')).toBeVisible()
}

/** 属性栏核对卡（PC-2）收起时展开它；给了 data-sec 时再展开那个折叠的清单（PC-8） */
export async function openCheckList(page: Page, sec?: string) {
  await openPropsDrawer(page)
  const toggle = page.locator('.panel [data-card="check"] .card-toggle').first()
  await expect(toggle).toBeVisible()
  // 代码事实晚到时核对卡会自己展开（PC-2）：先等结论定下来（不再「读取中」），再按需单击并确认已展开；
  // 单击仍可能撞上自动展开把它收起（用户单击后以用户的为准），收起了就再点一次
  await expect(page.locator('.panel [data-card="check"] .card-sum').first()).not.toHaveText(/读取中/, { timeout: 20_000 })
  await expect(async () => {
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
  // ADR-0060：证据与清单整块缺省折叠（details），里面的清单与表单要点开才在
  await openPanelLists(page)
  if (!sec) return
  const fold = page.locator(`.panel [data-sec="${sec}"] .fold`).first()
  await expect(fold).toBeVisible()
  if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click()
}

/** ADR-0060：打开核对卡底部的「证据与清单」折叠块（缺省关闭）；没有这块（没有清单）时不动 */
export async function openPanelLists(page: Page) {
  const summary = page.locator('.panel [data-testid="check-lists-fold"]').first()
  if (!(await summary.count())) return
  const details = summary.locator('xpath=..')
  if ((await details.evaluate(el => (el as unknown as { open: boolean }).open)) !== true) await summary.click()
  await expect(details).toHaveJSProperty('open', true)
}

/** ADR-0060：相关资料卡条目多于 3 份时缺省收起；需要点里面的条目时先展开 */
export async function openRelated(page: Page) {
  const toggle = page.locator('.panel [data-card="related"] .card-toggle').first()
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

/**
 * DL-4、DL-20（第二十一轮波 2）：进入草图画布时辅助栏按主语表打开并固定「对话」，选中面板缺省收起——画布不再被挤压，资料区不用关
 */
export async function expectSketchLayout(page: Page) {
  const dock = page.getByRole('complementary', { name: '资料区' })
  await expect(dock.locator('.tab.on:not(.preview)')).toContainText('对话')
  await expect(page.getByRole('complementary', { name: '属性' })).toHaveCount(0)
}

/** DL-20：草图编辑态要用表单时按需展开选中面板（浮在画布右侧） */
export async function openSketchPanel(page: Page) {
  const props = page.getByRole('complementary', { name: '属性' })
  if (!(await props.count())) await page.locator('.props-toggle').click()
  await expect(props).toBeVisible()
}

/** DL-20：用完表单收起（浮在画布右侧的面板会挡住右边的节点） */
export async function closeSketchPanel(page: Page) {
  const props = page.getByRole('complementary', { name: '属性' })
  if (await props.count()) await page.locator('.props-toggle').click()
  await expect(props).toHaveCount(0)
}

const SELF_PROJECT = path.resolve(import.meta.dirname, '../model/h5p-arch-desk')

/**
 * 在架构台自身（h5p-arch-desk）上新建一个临时设计并打开它的草图；返回清理函数与读 design.yaml。
 * 清理：还在跑的一轮先停下，删目录（停止前子进程可能已说完、随后追加转录会把目录又建出来——等一下再删一次），
 * 删 `extra` 里的文件，撤销指纹与拦截记录里这个设计的痕迹。
 */
export async function sketchOn(page: Page, design: string, opts: { mount?: string; extra?: readonly string[]; goal?: string } = {}) {
  const { mount = 'state.desk', extra = [], goal = 'E2E' } = opts
  const dir = path.join(SELF_PROJECT, 'designs', design)
  const OWNED = path.join(SELF_PROJECT, 'governance/owned.json')
  const LEDGER = path.join(SELF_PROJECT, 'governance/ledger.jsonl')
  const owned0 = fs.readFileSync(OWNED, 'utf8')
  const restore = async () => {
    const stop = page.getByTestId('dialogue-stop')
    if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => {})
    await new Promise(r => setTimeout(r, 300))
    fs.rmSync(dir, { recursive: true, force: true })
    await new Promise(r => setTimeout(r, 1500))
    fs.rmSync(dir, { recursive: true, force: true })
    for (const f of extra) fs.rmSync(f, { force: true })
    restoreOwned(OWNED, owned0, [`designs/${design}/`])
    if (fs.existsSync(LEDGER)) {
      const lines = fs.readFileSync(LEDGER, 'utf8').split('\n')
      const rest = lines.filter(l => !l.includes(`"design":"${design}"`) && !l.includes(`"file":"designs/${design}/`))
      if (rest.length !== lines.length) fs.writeFileSync(LEDGER, rest.join('\n'))
    }
  }
  // 上一次没清干净（中途被杀）的同名设计先删掉
  fs.rmSync(dir, { recursive: true, force: true })
  for (const f of extra) fs.rmSync(f, { force: true })
  const r = await page.request.post(`./write/h5p-arch-desk/designs`, { data: { id: design, name: `E2E ${design}`, goal, mount } })
  expect(r.ok()).toBe(true)
  await openDesk(page, `/p/h5p-arch-desk/d/${design}/sketch`)
  await expect(page.locator('.sketch-canvas')).toBeVisible()
  return { restore, dir, yaml: () => fs.readFileSync(path.join(dir, 'design.yaml'), 'utf8') }
}
