/**
 * WS-3 首次适应（负责人 2026-10-31 报告刷新跳动）：刷新后，从画布节点第一次可见到稳定，视口的缩放只取一个值——
 * 不先以别的缩放露面再跳到适应后的尺寸。三个视角 × 带选中与不带选中，两个项目。
 */
import { expect, test, type Page } from '@playwright/test'

/** 每一帧记下「节点可见时」变换面板的缩放（节点还不可见的帧不记）；页面里的代码写成字符串（e2e 的 tsconfig 不带 DOM 类型） */
const RECORD_ZOOM = `(() => {
  const out = []
  window.__zoom = out
  const tick = () => {
    const node = document.querySelector('.vue-flow__node')
    const pane = document.querySelector('.vue-flow__transformationpane')
    if (node && pane && node.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
      const zoom = new DOMMatrixReadOnly(getComputedStyle(pane).transform).a
      if (out.at(-1)?.zoom !== zoom) out.push({ t: performance.now(), zoom })
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})()`

const zooms = (page: Page) => page.evaluate<{ t: number; zoom: number }[]>('window.__zoom')
const now = (page: Page) => page.evaluate<number>('performance.now()')

const PERSPECTIVES = [
  ['交互', ''],
  ['结构', 'v=s'],
] as const
const CASES = [
  { project: 'media-web-player', sel: 'sel=m:kit', scene: 'sc=sc.command' },
  { project: 'h5p-arch-desk', sel: 'sel=m:model', scene: 'sc=sc.open-and-play' },
]

for (const { project, sel, scene } of CASES)
  for (const [name, q] of [...PERSPECTIVES, ['运行', scene] as const])
    for (const withSel of [false, true])
      test(`WS-3：${project} ${name}视角${withSel ? '带选中' : ''}刷新后缩放只取一个值`, async ({ page }) => {
        const qs = [q, withSel ? sel : ''].filter(Boolean).join('&')
        await page.goto(`./#/p/${project}${qs ? `?${qs}` : ''}`)
        await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
        await page.addInitScript(RECORD_ZOOM)
        await page.reload()
        await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 20_000 })
        // 稳定：最后一次缩放变化之后 1.5 秒内不再变
        await expect
          .poll(async () => {
            const z = await zooms(page)
            return z.length > 0 && (await now(page)) - z.at(-1)!.t > 1500
          })
          .toBe(true)
        const values = (await zooms(page)).map(z => z.zoom)
        expect(Math.max(...values) / Math.min(...values), `缩放序列 ${values.join(' → ')}`).toBeLessThan(1.01)
      })
