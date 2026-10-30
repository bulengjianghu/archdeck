<script setup lang="ts">
/**
 * 时序图（D-2、D-7、R3、R5、R11）：只画定位好坐标的时序模型。
 * 单击消息（含未选分支上的）→ 指向该步，即选中它（R13）；单击 alt 的分支条件 → 选该分支（F6e）；悬停消息时在结构图上预览对应的边；选中突出（R15、R16）。
 * 泳道头固定在顶部、底部另有一份，消息区夹在中间纵向滚动，三块从左起排、不拉伸（D-2）；只在用户移动播放头后把当前步骤滚到中间（D-7）。
 * 不可见提示与「定位」在副栏标题栏（split/DockPane.vue，ADR-0010），「定位」调用这里暴露的 centerCurrent。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import { headsHeight } from '@/layout/sequence'
import { moduleName, type SequenceMessage } from '@/model'
import SequenceHeads from './SequenceHeads.vue'
import SequenceLanes from './SequenceLanes.vue'
import SequenceFragments from './SequenceFragments.vue'
import { weakestLevel } from '../panel/chain'

const desk = useDesk()
const scroller = ref<HTMLElement>()

const ps = computed(() => desk.run.positionedSequence.value)
const homeName = computed(() => (desk.index.value && desk.run.home.value ? moduleName(desk.index.value, desk.run.home.value) : ''))
const empty = computed(() => (desk.run.scenarioView.value?.messages.length ?? 0) === 0)
const top = computed(() => (ps.value ? headsHeight(ps.value) : 0))
/**
 * S17 + D-25（裁决 T0-10）：时序图「?」的口径——各帧的证据等级已由状态层按承载判定对齐（无承载才标），一条消息取合并的各帧中最弱的一档；
 * 没有代码事实时为 null（不标）
 */
const noEvidence = computed<Set<number> | null>(() => {
  const p = ps.value
  const levels = desk.evidence.levels.value
  if (!p || !levels) return null
  return new Set(p.model.messages.flatMap((m, i) => (weakestLevel(m.frameIds, levels) === 'none' ? [i] : [])))
})
const groupName = (parentId: string) => (desk.index.value ? moduleName(desk.index.value, parentId) : parentId)

function pick(m: SequenceMessage) {
  desk.seek(m.frameIds[0])
}
function hover(m: SequenceMessage | null) {
  desk.setHover(m ? `step:${m.frameIds[0]}` : null)
}
function branch(pointId: string, option: number) {
  desk.chooseBranch(pointId, option)
}

/** 把当前步骤滚到消息区的纵向中间 */
function centerCurrent() {
  const el = scroller.value
  const p = ps.value
  const ci = desk.run.currentIndex.value
  if (!el || !p || ci === null) return
  const i = p.model.messages.findIndex(m => m.pathIndex === ci)
  if (i < 0) return
  // 消息纵坐标即内容中的位置（顶部泳道头占据 0..top）；不用平滑滚动：连续单步时平滑滚动会被下一次渲染打断
  el.scrollTop = Math.max(0, p.messages[i].y - el.clientHeight / 2)
}

defineExpose({ centerCurrent })

// D-7：只在用户移动播放头后滚动——悬停、选中、切换层次、重新加载都不改播放头，不会触发
watch(
  () => desk.playback.value?.frameId,
  async () => {
    await nextTick()
    centerCurrent()
  },
  { immediate: true },
)
</script>

<template>
  <section class="sequence">
    <div ref="scroller" class="body">
      <div v-if="empty" class="empty">
        <p>本层看不到这个场景的任何一步。</p>
        <button v-if="desk.run.home.value" @click="desk.goTo(desk.run.home.value)">跳到场景所在层次：{{ homeName }}</button>
      </div>
      <template v-else-if="ps">
        <div class="pin top"><SequenceHeads :ps="ps" where="top" :group-name="groupName" :lanes="desk.run.emphasis.value?.lanes" /></div>
        <svg :width="ps.size.w" :height="ps.size.h - top" :viewBox="`0 ${top} ${ps.size.w} ${ps.size.h - top}`" class="svg">
          <defs>
            <marker id="seq-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
            </marker>
            <marker id="seq-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10" fill="none" stroke="context-stroke" stroke-width="1.5" />
            </marker>
          </defs>
          <SequenceFragments :ps="ps" @branch="branch" />
          <SequenceLanes
            :ps="ps"
            :no-evidence="noEvidence"
            :current="desk.run.currentIndex.value"
            :walked="desk.run.walked.value"
            :hover="desk.hoverId.value"
            :emphasis="desk.run.emphasis.value"
            @pick="pick"
            @hover="hover"
          />
        </svg>
        <div class="pin bottom"><SequenceHeads :ps="ps" where="bottom" :group-name="groupName" :lanes="desk.run.emphasis.value?.lanes" /></div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.sequence {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  flex: 1 1 auto;
  background: var(--surface);
}

.body {
  flex: 1 1 auto;
  overflow: auto;
  min-height: 0;
}

/* D-2：泳道头首尾固定，与消息区同在一个滚动容器里，横向滚动时一起移动 */
.pin {
  position: sticky;
  z-index: 2;
  width: max-content;
  min-width: 100%;
  background: var(--surface);
}

.pin.top {
  top: 0;
  border-bottom: 1px solid var(--border);
}

.pin.bottom {
  bottom: 0;
  border-top: 1px solid var(--border);
}

.svg {
  display: block;
}

.empty {
  display: grid;
  place-content: center;
  gap: 8px;
  height: 100%;
  color: var(--text-2);
  text-align: center;
}

.empty p {
  margin: 0;
}
</style>
