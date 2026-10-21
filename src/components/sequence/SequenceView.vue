<script setup lang="ts">
/**
 * 时序图（D-2、D-7、R3、R5、R11）：只画定位好坐标的时序模型。
 * 单击消息（含未选分支上的）→ 指向该步（R13）；单击 alt 的分支条件 → 选该分支（F6e）；悬停消息时在结构图上预览对应的边；焦点突出（R15）。
 * 泳道头固定在顶部、底部另有一份，消息区夹在中间纵向滚动（D-2）；只在用户移动播放头后把当前步骤滚到中间，「定位」同理（D-7）。
 * 收起、页签与分屏方向切换在副栏（split/AsidePane.vue）；这里只画信息条（当前层次、当前帧不可见的提示、定位）与时序图本身。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import { headsHeight } from '@/layout/sequence'
import { moduleName, type SequenceMessage } from '@/model'
import SequenceHeads from './SequenceHeads.vue'
import SequenceLanes from './SequenceLanes.vue'
import SequenceFragments from './SequenceFragments.vue'

const desk = useDesk()
const scroller = ref<HTMLElement>()

const ps = computed(() => desk.positionedSequence.value)
const levelName = computed(() => (desk.index.value ? moduleName(desk.index.value, desk.levelId.value) : ''))
const homeName = computed(() => (desk.index.value && desk.home.value ? moduleName(desk.index.value, desk.home.value) : ''))
const empty = computed(() => (desk.scenarioView.value?.messages.length ?? 0) === 0)
const hiddenCurrent = computed(() => !!desk.frame.value && desk.currentIndex.value === null)
const top = computed(() => (ps.value ? headsHeight(ps.value) : 0))
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
  const ci = desk.currentIndex.value
  if (!el || !p || ci === null) return
  const i = p.model.messages.findIndex(m => m.pathIndex === ci)
  if (i < 0) return
  // 消息纵坐标即内容中的位置（顶部泳道头占据 0..top）；不用平滑滚动：连续单步时平滑滚动会被下一次渲染打断
  el.scrollTop = Math.max(0, p.messages[i].y - el.clientHeight / 2)
}

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
    <header class="bar">
      <strong>时序图</strong>
      <span class="muted">· {{ levelName }}</span>
      <span v-if="hiddenCurrent" class="hint warn">
        当前步骤在本层不可见：
        <button class="link" @click="desk.goTo(desk.frameLevel.value!)">到能看到它的层次</button>
      </span>
      <button v-if="ps && !empty" class="locate" :disabled="desk.currentIndex.value === null" @click="centerCurrent">定位</button>
    </header>
    <div ref="scroller" class="body">
      <div v-if="empty" class="empty">
        <p>本层看不到这个场景的任何一步。</p>
        <button v-if="desk.home.value" @click="desk.goTo(desk.home.value)">跳到场景所在层次：{{ homeName }}</button>
      </div>
      <template v-else-if="ps">
        <div class="pin top"><SequenceHeads :ps="ps" where="top" :group-name="groupName" /></div>
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
            :current="desk.currentIndex.value"
            :walked="desk.walked.value"
            :hover="desk.hoverId.value"
            :emphasis="desk.emphasis.value"
            @pick="pick"
            @hover="hover"
          />
        </svg>
        <div class="pin bottom"><SequenceHeads :ps="ps" where="bottom" :group-name="groupName" /></div>
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

.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  overflow: hidden;
  padding: 3px 10px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  flex: none;
}

.hint {
  margin-left: 12px;
  font-size: 12px;
}

.warn {
  color: var(--warning);
}

.locate {
  margin-left: auto;
  font-size: 12px;
  padding: 1px 8px;
}

.locate:disabled {
  opacity: 0.4;
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
  min-width: 100%;
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
