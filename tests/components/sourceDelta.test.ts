// @vitest-environment jsdom
/**
 * 源码胶囊（G22、TB-8）：描述的 source.commit 与源码树 HEAD 不一致时画布标题行一枚胶囊「描述落后 N 个提交」，单击展开原文（措辞与 lint:model 摘要同源）；
 * 落后超过阈值、描述的提交不在源码树中、源码不可用时着警示色；一致（delta 为 null）不渲染。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SourceDeltaChip from '../../src/components/source/SourceDeltaChip.vue'
import { SOURCE_LAG_WARN, sourceChipView } from '../../src/components/source/sourceChip'
import type { CommitDelta } from '../../src/model'

const delta: CommitDelta = { described: '59dbea080956e7d4f6acbc0f1f7773cc6e328611', head: '7a6f4b5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ahead: 12 }

describe('TB-8 源码胶囊', () => {
  it('不一致时胶囊写落后的提交数，单击展开描述与源码树的提交与差数；一致时不出现', async () => {
    const w = mount(SourceDeltaChip, { props: { delta } })
    const chip = w.find('button.source-chip')
    expect(chip.text()).toBe('描述落后 12 个提交')
    expect(chip.classes()).not.toContain('warn')
    expect(w.find('[role=status]').exists()).toBe(false)
    await chip.trigger('click')
    expect(w.find('[role=status]').text()).toContain('描述基于 59dbea08，源码树在 7a6f4b5a（差 12 个提交）')
    expect(w.find('[role=status]').text()).toContain('代码事实与源码验收读到的是当前源码树')
    await chip.trigger('click')
    expect(w.find('[role=status]').exists()).toBe(false)
    expect(
      mount(SourceDeltaChip, { props: { delta: null } })
        .find('button')
        .exists(),
    ).toBe(false)
  })

  it('着警示色：落后超过阈值、描述的提交不在源码树中、源码不可用', () => {
    expect(sourceChipView({ ...delta, ahead: SOURCE_LAG_WARN })?.warn).toBe(false)
    expect(sourceChipView({ ...delta, ahead: SOURCE_LAG_WARN + 1 })?.warn).toBe(true)
    expect(sourceChipView({ ...delta, ahead: null })).toMatchObject({ label: '描述的提交不在源码树中', warn: true })
    expect(sourceChipView(null, '找不到源码根目录')).toMatchObject({ label: '源码不可用', warn: true })
    expect(sourceChipView(null, '找不到源码根目录')?.note).toContain('找不到源码根目录')
    expect(sourceChipView(null)).toBeNull()
  })
})
