/** E2E 公共步骤：打开项目视图并等画布布局完成（布局在 Worker 中异步完成） */
import { expect, type Page } from '@playwright/test'

/** 打开 `#/p/...`（hash 路由），等结构图出现节点 */
export async function openDesk(page: Page, hashPath: string) {
  await page.goto(`./#${hashPath}`)
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
}

/** 当前地址的查询参数（hash 路由，参数在 # 之后） */
export function query(page: Page): URLSearchParams {
  const hash = new URL(page.url()).hash
  return new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
}

/** 结构图上的视图节点 */
export const graphNode = (page: Page, id: string) => page.locator(`.vue-flow__node[data-id="${id}"]`)
