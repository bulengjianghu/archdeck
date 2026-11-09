/** E2E 公共步骤：打开项目视图并等画布布局完成（布局在 Worker 中异步完成） */
import fs from 'node:fs'
import path from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'

/**
 * 负载预算（第二十一轮收尾 S0）：多会话并行时开发服务器读描述、现编译组件要好几秒；与 agent 一轮的等待同口径（ARCH_AGENT_TIMEOUT_MS = 20s 留余量）
 */
export const LOAD_BUDGET = 25_000

/**
 * 打开 `#/p/...`（hash 路由），等画布出现节点。负载下（第二十二轮 T3.6 定位）慢的是布局（Worker 里算，草图整张更重），不是服务端：
 * 草图的框节点在布局完成前是 0×0，所以先按 LOAD_BUDGET 整段等它，等不到才重新加载一次再等一个 LOAD_BUDGET——重新加载会让布局从头再算，不能早于预算
 */
export async function openDesk(page: Page, hashPath: string) {
  const node = page.locator('.vue-flow__node').first()
  await page.goto(`./#${hashPath}`)
  let tries = 0
  await expect(async () => {
    if (tries++ > 0) await page.reload()
    await expect(node).toBeVisible({ timeout: LOAD_BUDGET })
  }).toPass({ timeout: 2 * LOAD_BUDGET + 10_000, intervals: [0] })
}

/** TB-6、LY-2：打开侧栏顶上的项目菜单（版本、编辑骨架、新建设计、所有项目）；已打开时不动 */
export async function openProjectMenu(page: Page) {
  const btn = page.getByRole('button', { name: '项目菜单' })
  // 项目标题区在侧栏顶上，侧栏收起时先展开（LY-3）
  await openSidebar(page)
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

/**
 * 第二十二轮语义锚点（ADR-0064）：视图区 `data-region="views"`、视图标签 `data-view-tab="<类型>"`、资料标签 `data-doc-tab="<种类>"` 与键 `data-doc`、
 * 组 `data-group`。E2E 只认这些锚点，不认版式（波 2 换版式时选择器不动）。
 */
export const views = (page: Page) => page.locator('[data-region="views"]')
export const viewTab = (page: Page, kind: 'explainer' | 'description' | 'check' | 'sequence') => views(page).locator(`.tab[data-view-tab="${kind}"]`)
export const docTab = (page: Page, id: string) => views(page).locator(`.tab[data-doc="${id}"]`)
/** 资料标签（不跟随主语的那一类） */
export const docTabs = (page: Page) => views(page).locator('.tab[data-doc-tab]')
/** 第 group 组激活的标签 */
export const activeTab = (page: Page, group = 0) => views(page).locator(`[data-group="${group}"] .tab.on`)
/** 激活某个视图标签 */
export async function showView(page: Page, kind: 'explainer' | 'description' | 'check' | 'sequence') {
  // 视图区收起时先展开（LY-12）
  if (!(await views(page).count())) await page.locator('[data-head="canvas"]').getByRole('button', { name: '视图区', exact: true }).click()
  await viewTab(page, kind).locator('.lbl').click()
  await expect(viewTab(page, kind)).toHaveClass(/\bon\b/)
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

/** 侧栏（LY-3、LY-4）：停靠在画布左边，开关在最左竖栏的顶格（负责人 2026-11-08 走查） */
export const sidebar = (page: Page) => page.locator('[data-region="sidebar"]')
export const rail = (page: Page) => page.locator('[data-region="rail"]')
const sidebarToggle = (page: Page) => page.locator('[data-head="rail"]').getByRole('button', { name: '侧栏', exact: true })
export async function openSidebar(page: Page) {
  const t = sidebarToggle(page)
  if ((await t.getAttribute('aria-pressed')) !== 'true') await t.click()
  await expect(page.locator('[data-head="sidebar"]')).toBeVisible()
}
/** 侧栏挤压画布：要画布宽一些（或测画布上的几何）时先收起 */
export async function closeNav(page: Page) {
  const t = sidebarToggle(page)
  if ((await t.getAttribute('aria-pressed')) === 'true') await t.click()
  await expect(page.locator('[data-head="sidebar"]')).toHaveCount(0)
}
/** 切到侧栏的某一页：竖栏图标——侧栏收起时展开并切页；已在这一页时不动（再点会收起） */
export async function sidePage(page: Page, name: 'modules' | 'scenes' | 'changes') {
  const icon = rail(page).locator(`[data-rail="${name}"]`)
  if ((await icon.getAttribute('aria-pressed')) !== 'true') await icon.click()
  await expect(icon).toHaveAttribute('aria-pressed', 'true')
}
/** 侧栏这一页的「筛选 ▾」弹层（LY-4d）：打开并返回它 */
export async function openFilters(page: Page) {
  const pop = sidebar(page).locator('[data-filter-pop]')
  if (!(await pop.count())) await sidebar(page).locator('[data-side-filter]').click()
  await expect(pop).toBeVisible()
  return pop
}

/** 第二十二轮：抽屉已删，原选中面板除核对卡以外的内容在「描述」标签（LY-13），核对卡在「核对」标签 */
export const openPanel = openPropsDrawer

export async function openPropsDrawer(page: Page) {
  // 描述加载完成前点击会与就绪渲染竞态：先等加载态结束
  await expect(page.locator('.canvas-area .state')).toHaveCount(0, { timeout: 30_000 })
  await showView(page, 'description')
  await expect(views(page).locator('.panel[data-part="description"], [data-testid="dock-step-side"]').first()).toBeVisible()
}

/** 核对卡（PC-2）收起时展开它；给了 data-sec 时再展开那个折叠的清单（PC-8）。核对卡住「核对」标签（LY-13） */
export async function openCheckList(page: Page, sec?: string) {
  await expect(page.locator('.canvas-area .state')).toHaveCount(0, { timeout: 30_000 })
  await showView(page, 'check')
  // 回放中：步骤 / 场景面板的核对卡在核对标签的步骤节
  const side = page.getByTestId('check-step-side')
  if ((await side.count()) && (await side.locator('[data-card="check"]').count())) {
    const t = side.locator('[data-card="check"] .card-toggle').first()
    await expect(side.locator('[data-card="check"] .card-sum').first()).not.toHaveText(/读取中/, { timeout: 20_000 })
    await expect(async () => {
      if ((await t.getAttribute('aria-expanded')) === 'false') await t.click()
      await expect(t).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 })
    }).toPass({ timeout: 15_000 })
    const fs = side.locator('[data-testid="check-lists-fold"]').first()
    if (await fs.count()) {
      const d = fs.locator('xpath=..')
      if ((await d.evaluate(el => (el as unknown as { open: boolean }).open)) !== true) await fs.click()
    }
    if (!sec) return
    const fold = side.locator(`[data-sec="${sec}"] .fold`).first()
    if ((await fold.count()) && (await fold.getAttribute('aria-expanded')) === 'false') await fold.click()
    return
  }
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
 * LY-11（第二十二轮）：进入草图画布时视图区按草图情境的排布——上组对话（固定、激活），下组描述（草图面板）
 */
export async function expectSketchLayout(page: Page) {
  // LY-11：草图情境的缺省排布——上组激活的是固定的对话
  await expect(activeTab(page, 0)).toHaveAttribute('data-doc', 'dlg')
  await expect(activeTab(page, 0)).not.toHaveClass(/preview/)
  await expect(activeTab(page, 1)).toHaveAttribute('data-view-tab', 'description')
}

/** DL-20（第二十二轮波 2）：草图面板（表单）在下组的「描述」标签 */
export async function openSketchPanel(page: Page) {
  await showView(page, 'description')
  await expect(views(page).locator('.sk-panel')).toBeVisible()
}

/** 草图面板在视图区，不挡画布；保留这个步骤以便旧用例照常调用 */
export async function closeSketchPanel(_page: Page) {}

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
  // 建好设计之后的任何一步失败都先清理再抛（收尾 S0：负载下打开画布超时曾留下临时设计）
  try {
    const r = await page.request.post(`./write/h5p-arch-desk/designs`, { data: { id: design, name: `E2E ${design}`, goal, mount } })
    expect(r.ok()).toBe(true)
    await openDesk(page, `/p/h5p-arch-desk/d/${design}/sketch`)
    await expect(page.locator('.sketch-canvas')).toBeVisible()
  } catch (e) {
    await restore()
    throw e
  }
  return { restore, dir, yaml: () => fs.readFileSync(path.join(dir, 'design.yaml'), 'utf8') }
}
