/**
 * X7a（第五轮 T3）：有未保存改动时离开（退出、切换版本、回项目列表、前进后退）三选——保存 / 放弃 / 取消；保存失败留下并说明原因。
 */
import { describe, expect, it, vi } from 'vitest'
import { confirmLeave } from '../../src/components/edit/leave'
import { answer, editDialog } from '../../src/components/edit/useEditDialog'

type Edit = Parameters<typeof confirmLeave>[0]
const edit = (over: Partial<{ dirty: boolean; errors: number; save: Awaited<ReturnType<Edit['save']>> }> = {}) => {
  const save = vi.fn(async () => over.save ?? ({ ok: true, dropped: [] } as unknown as Awaited<ReturnType<Edit['save']>>))
  return {
    e: {
      canLeave: () => (over.dirty === false ? 'free' : 'confirm'),
      designErrors: { value: Array.from({ length: over.errors ?? 0 }, () => ({})) },
      save,
    } as unknown as Edit,
    save,
  }
}
/** 等对话框出现后回答 */
async function reply(p: Promise<boolean>, a: 'ok' | 'alt' | 'cancel') {
  await vi.waitFor(() => expect(editDialog.value).not.toBeNull())
  expect([editDialog.value!.ok, editDialog.value!.alt]).toEqual(['保存', '放弃'])
  answer(a)
  return p
}

describe('X7a 离开时三选', () => {
  it('没有改动：直接放行，不弹对话框', async () => {
    const { e } = edit({ dirty: false })
    expect(await confirmLeave(e, 'switch', () => {})).toBe(true)
    expect(editDialog.value).toBeNull()
  })

  it('取消：留下；放弃：放行且不保存；保存：保存成功后放行', async () => {
    const a = edit()
    expect(
      await reply(
        confirmLeave(a.e, 'switch', () => {}),
        'cancel',
      ),
    ).toBe(false)
    expect(
      await reply(
        confirmLeave(a.e, 'switch', () => {}),
        'alt',
      ),
    ).toBe(true)
    expect(a.save).not.toHaveBeenCalled()
    expect(
      await reply(
        confirmLeave(a.e, 'exit', () => {}),
        'ok',
      ),
    ).toBe(true)
    expect(a.save).toHaveBeenCalledOnce()
  })

  it('保存失败（格式错误、冲突）：留下并说明原因', async () => {
    const report = vi.fn()
    const bad = edit({ errors: 2 })
    expect(await reply(confirmLeave(bad.e, 'switch', report), 'ok')).toBe(false)
    expect(bad.save).not.toHaveBeenCalled()
    expect(report).toHaveBeenLastCalledWith('有 2 个格式错误，先改正再保存')
    const conflict = edit({ save: { ok: false, conflict: true, error: 'x' } as never })
    expect(await reply(confirmLeave(conflict.e, 'switch', report), 'ok')).toBe(false)
    expect(report).toHaveBeenLastCalledWith('文件已变，重新加载并重放后再保存')
  })
})
