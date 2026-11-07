/**
 * 第十二轮 A（ADR-0038）：普通层次按本层值依赖分层（L28），层多时画层带与层号（L29），拆分信号（K21）与向上的线（K22）。
 * 以本项目与 h5player 验收（01 §6.25）。
 */
import { expect, test } from '@playwright/test'
import { graphNode, openDesk, openPanel, waitSettled, openCheckList } from './helpers'

const top = async (page: Parameters<typeof graphNode>[0], id: string) => (await graphNode(page, id).boundingBox())!.y

test('ADR-0052：本项目「模型层」声明四层（层是分类、不占级）——打开即 4 条带，单成员层的带即成员，契约在最下，切到结构视角节点不动', async ({ page }) => {
  test.setTimeout(150_000)
  await openDesk(page, '/p/h5p-arch-desk?level=model')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  const bandTop = async (id: string) => (await graphNode(page, id).boundingBox())!.y
  // 交付、契约是单成员层：带即成员（返工清单、类型与 Schema）；解释、描述是多成员层：带节点为 s:<父模块>/<层>
  for (const [id, name] of [
    ['model.rework', '返工清单'],
    ['s:model/explain', '解释'],
    ['s:model/description', '描述'],
    ['model.types', '类型与 Schema'],
  ] as const)
    await expect(page.locator(`.vue-flow__node[data-id="${id}"]`)).toContainText(name)
  expect(await bandTop('model.rework')).toBeLessThan(await bandTop('s:model/explain'))
  expect(await bandTop('s:model/explain')).toBeLessThan(await bandTop('s:model/description'))
  expect(await bandTop('s:model/description')).toBeLessThan(await bandTop('model.types'))
  const types = await top(page, 'model.types')
  for (const id of ['model.pipeline', 'model.governance', 'model.projector']) expect(await top(page, id)).toBeLessThan(types)
  // 位置要跨两次加载逐字节相等：先等首帧后的整体平移（再适应）结束，两边都在稳定态上读。
  // 合并复跑（round21/integration）：全量并行时别的用例临时改写本项目描述（grading 的 roles.yaml、approval 的临时模块等，结束时恢复），
  // 落在两次加载之间布局就不同——两次读数成对重试，同一份描述上比
  let first = true
  await expect(async () => {
    if (!first) {
      await openDesk(page, '/p/h5p-arch-desk?level=model')
      await openPanel(page)
    }
    first = false
    await waitSettled(page)
    const before = await graphNode(page, 'model.governance').boundingBox()
    await openDesk(page, '/p/h5p-arch-desk?level=model&v=s')
    await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
    await expect(page.locator('.vue-flow__node[data-id="model.types"]')).toBeAttached()
    await waitSettled(page)
    expect(await graphNode(page, 'model.governance').boundingBox()).toEqual(before)
  }).toPass({ timeout: 90_000 })
})

test('ST-1、K21：DeskState 声明了三层（同步适配器 → 写入口 → 派生）——分层总览、不算依赖深度；选中后面板「拆分信号」列出不占文件的子模块', async ({ page }) => {
  await openDesk(page, '/p/h5p-arch-desk?level=state.desk')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  for (const id of ['s:state.desk/sync', 's:state.desk/write', 's:state.desk/derive']) await expect(graphNode(page, id)).toBeVisible()
  await expect(page.getByTestId('tier-hint')).toHaveCount(0)
  await expect(page.locator('.vue-flow__node[data-id^="tier:"]')).toHaveCount(0)
  // 单击多成员层的带选中层（V2，sel=s:），面板为层面板
  await graphNode(page, 's:state.desk/derive').click({ position: { x: 40, y: 12 } })
  await expect(page.getByTestId('stratum-panel')).toContainText('只读状态与模型')
  await openDesk(page, '/p/h5p-arch-desk?level=state&sel=m:state.desk')
  // LY-13：「拆分信号」是核对卡的清单（核对标签）；openCheckList 一并展开证据与清单
  await openCheckList(page)
  const split = page.getByTestId('split-signals')
  await expect(split).toBeVisible()
  await split.getByRole('button', { name: /^▸ 拆分信号/ }).click()
  await expect(split).toContainText('不占文件')
  // 声明了分层的层次只查向上的线（K22），不再报「有交互、没有值依赖」（K21③ 只对普通层次）
  await expect(split).not.toContainText('有交互、没有值依赖')
})

test('K22：h5player「MUs 媒体单元」缓冲 → 校正器向上，面板写明是控制反转', async ({ page }) => {
  await openDesk(page, '/p/h5player?level=infra.mus')
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  expect(await top(page, 'infra.mus.buffer')).toBeGreaterThan(await top(page, 'infra.mus.corrector'))
  const edge = page.locator('.vue-flow__edge[data-id^="infra.mus.buffer->infra.mus.corrector"]').first()
  const id = await edge.getAttribute('data-id')
  await openDesk(page, `/p/h5player?level=infra.mus&sel=${encodeURIComponent(`e:${id}`)}`)
  await openPanel(page) // 抽屉缺省收起（第二十轮 §4）
  await expect(page.getByTestId('upward-note')).toContainText('控制反转')
})
