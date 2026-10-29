/**
 * 第十二轮 A（ADR-0038）：普通层次按本层值依赖分层（L28），层多时画层带与层号（L29），拆分信号（K21）与向上的线（K22）。
 * 以本项目与 h5player 验收（01 §6.25）。
 */
import { expect, test } from '@playwright/test'
import { graphNode, openDesk, waitSettled } from './helpers'

const top = async (page: Parameters<typeof graphNode>[0], id: string) => (await graphNode(page, id).boundingBox())!.y

test('ADR-0051：本项目「模型层」声明为四层——打开即 4 条带，契约在最下，切到结构视角节点不动', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=model')
  const bandTop = async (id: string) => (await graphNode(page, id).boundingBox())!.y
  for (const [id, name] of [
    ['model.deliver', '交付'],
    ['model.explain', '解释'],
    ['model.description', '描述'],
    ['model.contract', '契约'],
  ] as const)
    await expect(page.locator(`.vue-flow__node[data-id="${id}"]`)).toContainText(name)
  expect(await bandTop('model.deliver')).toBeLessThan(await bandTop('model.explain'))
  expect(await bandTop('model.explain')).toBeLessThan(await bandTop('model.description'))
  expect(await bandTop('model.description')).toBeLessThan(await bandTop('model.contract'))
  const types = await top(page, 'model.types')
  for (const id of ['model.pipeline', 'model.governance', 'model.projector']) expect(await top(page, id)).toBeLessThan(types)
  // 位置要跨两次加载逐字节相等：先等首帧后的整体平移（再适应）结束，两边都在稳定态上读
  await waitSettled(page)
  const before = await graphNode(page, 'model.governance').boundingBox()
  await openDesk(page, '/p/h5p-arch-desk?level=model&v=s')
  await expect(page.locator('.vue-flow__node[data-id="model.contract"]')).toBeAttached()
  await waitSettled(page)
  expect(await graphNode(page, 'model.governance').boundingBox()).toEqual(before)
})

test('K21、L29：DeskState 没有依赖——画布角提示不分层；选中后面板「拆分信号」列出不占文件的子模块', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=state.desk')
  await expect(page.getByTestId('tier-hint')).toContainText('没有依赖')
  await expect(page.locator('.vue-flow__node[data-id^="tier:"]')).toHaveCount(0)
  await openDesk(page, '/p/h5p-arch-desk?level=state&sel=m:state.desk')
  // G11 V15c：「拆分信号」折叠在 ⑤，展开再断言清单
  const split = page.getByTestId('split-signals')
  await expect(split).toBeVisible()
  await split.getByRole('button', { name: /^▸ 拆分信号/ }).click()
  await expect(split).toContainText('不占文件')
  await expect(split).toContainText('有交互、没有值依赖')
})

test('K22：h5player「MUs 媒体单元」缓冲 → 校正器向上，面板写明是控制反转', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra.mus')
  expect(await top(page, 'infra.mus.buffer')).toBeGreaterThan(await top(page, 'infra.mus.corrector'))
  const edge = page.locator('.vue-flow__edge[data-id^="infra.mus.buffer->infra.mus.corrector"]').first()
  const id = await edge.getAttribute('data-id')
  await openDesk(page, `/p/h5player?level=infra.mus&sel=${encodeURIComponent(`e:${id}`)}`)
  await expect(page.getByTestId('upward-note')).toContainText('控制反转')
})
