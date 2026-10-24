/** 副栏页签（G15）：打开场景、移动播放头切到「时序图」；描述重新加载（N5）后 playback 换了对象但场景与帧不变，预览的源代码页签保持 */
import { nextTick, ref, shallowRef } from 'vue'
import { describe, expect, it } from 'vitest'
import { useAside } from '../../src/components/split/useAside'
import type { DeskState } from '../../src/state/useDeskState'

function fakeDesk() {
  const selected = ref<string | null>(null)
  const perspective = ref<'interaction' | 'run'>('run')
  const playback = shallowRef<{ scenarioId: string; frameId: string } | null>({ scenarioId: 'sc', frameId: 'f1' })
  const desk = { files: { selected }, perspective, playback } as unknown as Pick<DeskState, 'files' | 'perspective' | 'playback'>
  return { desk, perspective, playback }
}

describe('useAside 页签', () => {
  it('预览文件后，playback 换了对象但场景与帧不变（描述重新加载）：仍是「源代码」', async () => {
    const { desk, playback } = fakeDesk()
    const aside = useAside(desk)
    aside.open('src/a.ts')
    expect(aside.tab.value).toBe('source')
    playback.value = { scenarioId: 'sc', frameId: 'f1' }
    await nextTick()
    expect(aside.tab.value).toBe('source')
  })
  it('移动播放头、换场景：切到「时序图」', async () => {
    const { desk, playback } = fakeDesk()
    const aside = useAside(desk)
    aside.open('src/a.ts')
    playback.value = { scenarioId: 'sc', frameId: 'f2' }
    await nextTick()
    expect(aside.tab.value).toBe('sequence')
    aside.open('src/a.ts')
    playback.value = { scenarioId: 'sc2', frameId: 'f2' }
    await nextTick()
    expect(aside.tab.value).toBe('sequence')
  })
  it('离开运行视角时有预览文件：回到「源代码」', async () => {
    const { desk, perspective } = fakeDesk()
    const aside = useAside(desk)
    aside.open('src/a.ts')
    perspective.value = 'interaction'
    await nextTick()
    expect(aside.tab.value).toBe('source')
  })
})
