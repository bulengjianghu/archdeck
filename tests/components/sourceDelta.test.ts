// @vitest-environment jsdom
/**
 * 源码版本提示条（G22）：描述的 source.commit 与源码树 HEAD 不一致时常显一条，措辞与 lint:model 摘要同源；一致（delta 为 null）不渲染。
 */
import { it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SourceDeltaBar from '../../src/components/source/SourceDeltaBar.vue'
import type { CommitDelta } from '../../src/model'

const delta: CommitDelta = { described: '59dbea080956e7d4f6acbc0f1f7773cc6e328611', head: '7a6f4b5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ahead: 12 }

it('不一致时显示描述与源码树的提交与差数；一致时不出现', () => {
  const w = mount(SourceDeltaBar, { props: { delta } })
  expect(w.find('[role=status]').text()).toContain('描述基于 59dbea08，源码树在 7a6f4b5a（差 12 个提交）')
  expect(w.find('[role=status]').text()).toContain('代码事实与源码验收读到的是当前源码树')
  expect(
    mount(SourceDeltaBar, { props: { delta: null } })
      .find('[role=status]')
      .exists(),
  ).toBe(false)
})
