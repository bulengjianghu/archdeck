/** E2E 公共步骤：打开项目视图并等画布布局完成（布局在 Worker 中异步完成） */
import fs from 'node:fs'
import { expect, type Locator, type Page } from '@playwright/test'

/** 打开 `#/p/...`（hash 路由），等结构图出现节点 */
export async function openDesk(page: Page, hashPath: string) {
  await page.goto(`./#${hashPath}`)
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
}

/** 等画布布局稳定：首帧后约半秒还会再适应一次（节点整体平移），节点位置连续三次（约 0.75 s）不变才算稳定 */
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
