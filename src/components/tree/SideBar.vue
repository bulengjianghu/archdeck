<script setup lang="ts">
/**
 * 侧栏（LY-3、LY-4，ADR-0064）：系统的名词，停靠在画布左边，可收起、可拖宽（开合与宽度是工作区状态、按本机记住，只由人开合）。
 * 页头 44px 是项目标题（项目菜单，LY-2，由项目视图摆在侧栏顶上）；其下三页——模块（树，根行 = 系统；「按模块 / 按文件」两种树，LY-4b）、
 * 场景（列表，单击进入回放；回放中先列这个场景的步骤，LY-4c）、改动（只在设计的草图编辑时可用，CI-4）。
 * 切页在最左的竖栏（SideRail，负责人 2026-11-08 走查）；页内第一行是页名，右端「筛选 ▾」（有生效的筛选时带数量），
 * 弹层里是这一页的全部筛选（LY-4d：模块页——树、排序、只看需复核；场景页——范围、类别、发起者）。
 * 页只属于这块界面（SIDE_NAV，由项目视图持有），不进视图状态与 URL；进入回放切到「场景」页（只换页，不开合侧栏）。
 */
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import { useSideNav } from '../shared/navTab'
import ScenarioList from '../ScenarioList.vue'
import ModuleTree from './ModuleTree.vue'
import StepTree from './StepTree.vue'
import FileTree from './FileTree.vue'
import ChangesTab from './ChangesTab.vue'
import SketchTree from '../sketch/SketchTree.vue'
import ScenarioFilters from './ScenarioFilters.vue'
import { SIDE_FILTERS, activeFilterCount, useSideFilters } from '../shared/sideFilters'

const desk = useDesk()
const { page, mode } = useSideNav()
const playing = computed(() => !!desk.playback.value)
/** LY-4c：回放中场景页先列步骤；「全部场景」换回列表 */
const showList = ref(false)
watch(
  playing,
  on => {
    showList.value = false
    if (on) page.value = 'scenes'
  },
  { immediate: true },
)
/** 选中文件时切到按文件的树（G14） */
watch(
  () => desk.files.selected.value,
  f => {
    if (!f) return
    page.value = 'modules'
    mode.value = 'files'
  },
)
/** CI-4：改动页只在设计的草图画布下 */
const hasChanges = computed(() => desk.edit.active.value && desk.edit.target?.kind === 'design')
watch(hasChanges, on => !on && page.value === 'changes' && (page.value = 'modules'))
watch(
  () => desk.edit.changes.reveal.value,
  r => r && hasChanges.value && (page.value = 'changes'),
)

/** LY-4d：「筛选 ▾」——模块页（不在草图里）与场景列表才有 */
const filters = useSideFilters()
// 树与场景列表读同一份——没有项目视图提供时也一样
provide(SIDE_FILTERS, filters)
const PAGE_NAME = { modules: '模块', scenes: '场景', changes: '改动' } as const
const filterPage = computed<'modules' | 'scenes' | null>(() =>
  page.value === 'modules' && !desk.edit.active.value
    ? 'modules'
    : page.value === 'scenes' && !desk.edit.active.value && (!playing.value || showList.value)
      ? 'scenes'
      : null,
)
const filterCount = computed(() => (filterPage.value ? activeFilterCount(filterPage.value, filters, mode.value) : 0))
const popOpen = ref(false)
const popEl = ref<HTMLElement>()
watch(filterPage, () => (popOpen.value = false))
const onDoc = (e: MouseEvent) => {
  if (popOpen.value && popEl.value && !popEl.value.contains(e.target as Node)) popOpen.value = false
}
onMounted(() => document.addEventListener('mousedown', onDoc))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc))
const evoReady = computed(() => desk.evolution.status.value === 'ready')
const heatKind = computed(() => (desk.toggles.heat === 'fixes' ? '缺陷' : '修改'))

// LY-3：右沿可拖宽（200–400 由状态层夹住）
const root = ref<HTMLElement>()
function onResizeDown(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent) => {
    const left = root.value?.getBoundingClientRect().left ?? 0
    desk.workspace.dispatch({ type: 'setSidebar', width: ev.clientX - left })
  }
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}
</script>

<template>
  <nav ref="root" class="side-bar" aria-label="侧栏" data-region="sidebar">
    <div ref="popEl" class="page-head">
      <b class="page-name" data-side-page-name>{{ PAGE_NAME[page] }}</b>
      <span v-if="page === 'changes' && hasChanges && desk.edit.changes.items.value.length" class="count">{{ desk.edit.changes.items.value.length }}</span>
      <button
        v-if="filterPage"
        class="fbtn"
        :class="{ open: popOpen }"
        :aria-expanded="popOpen"
        aria-haspopup="true"
        data-side-filter
        @click="popOpen = !popOpen"
      >
        筛选<template v-if="filterCount">
          · <span class="n" data-filter-count>{{ filterCount }}</span></template
        >
        ▾
      </button>
      <div v-if="popOpen && filterPage" class="fpop" role="dialog" aria-label="筛选" data-filter-pop>
        <template v-if="filterPage === 'modules'">
          <div class="grp">
            <div class="fl">树</div>
            <div class="seg" role="group" aria-label="树">
              <button :class="{ on: mode === 'modules' }" :aria-pressed="mode === 'modules'" @click="mode = 'modules'">按模块</button>
              <button :class="{ on: mode === 'files' }" :aria-pressed="mode === 'files'" data-side-mode="files" @click="mode = 'files'">按文件</button>
            </div>
          </div>
          <div v-if="!playing && mode === 'modules'" class="grp">
            <div class="fl">排序</div>
            <div class="seg" role="group" aria-label="模块排序">
              <button :class="{ on: filters.sort.value === 'order' }" :aria-pressed="filters.sort.value === 'order'" @click="filters.sort.value = 'order'">
                描述顺序
              </button>
              <button
                :class="{ on: filters.sort.value === 'heat' }"
                :aria-pressed="filters.sort.value === 'heat'"
                :disabled="!evoReady"
                :title="evoReady ? `按${heatKind}热度降序（同一父模块下）` : '没有演化事实'"
                @click="filters.sort.value = 'heat'"
              >
                按热度
              </button>
            </div>
          </div>
          <label v-if="mode === 'modules' && (desk.review.stale.value.size || filters.onlyStale.value)" class="chk">
            <input v-model="filters.onlyStale.value" type="checkbox" /> 只看需复核 <span class="warn">{{ desk.review.stale.value.size }}</span>
          </label>
        </template>
        <ScenarioFilters v-else stacked />
      </div>
    </div>
    <div class="body">
      <ChangesTab v-if="page === 'changes' && hasChanges" />
      <template v-else-if="page === 'scenes' && !desk.edit.active.value">
        <template v-if="playing && !showList">
          <button class="back" data-testid="all-scenes" @click="showList = true">‹ 全部场景</button>
          <StepTree />
        </template>
        <template v-else>
          <button v-if="playing" class="back" @click="showList = false">‹ 这个场景的步骤</button>
          <ScenarioList inline />
        </template>
      </template>
      <SketchTree v-else-if="desk.edit.active.value" />
      <template v-else>
        <FileTree v-if="mode === 'files'" />
        <ModuleTree v-else />
      </template>
    </div>
    <div class="resize" role="separator" aria-orientation="vertical" aria-label="拖动调整侧栏宽度" @pointerdown="onResizeDown" />
  </nav>
</template>

<style scoped>
.side-bar {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.page-head {
  position: relative;
  flex: none;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 14px;
}

.page-name {
  font-weight: 600;
  font-size: 12.5px;
}

.fbtn {
  margin-left: auto;
  padding: 2px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  font-size: 12px;
  color: var(--text-2);
}

.fbtn:hover,
.fbtn.open {
  color: var(--text);
  background: var(--surface-2);
}

.fbtn .n {
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.fpop {
  position: absolute;
  top: 34px;
  left: 8px;
  right: 8px;
  z-index: 30;
  display: grid;
  gap: 10px;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 10%);
  font-size: 12.5px;
}

.fl {
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--text-3);
}

.seg {
  display: flex;
  width: 100%;
}

.seg button {
  flex: 1 1 0;
  min-width: 0;
  font-size: 12px;
  border-radius: 0;
  white-space: nowrap;
}

.seg button:first-child {
  border-radius: 6px 0 0 6px;
}

.seg button:last-child {
  border-radius: 0 6px 6px 0;
  margin-left: -1px;
}

.seg button.on {
  position: relative;
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}

.chk {
  display: flex;
  align-items: center;
  gap: 6px;
}

.warn {
  color: var(--warning);
  font-variant-numeric: tabular-nums;
}

.count {
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 8px;
  font-size: 11px;
  background: var(--accent-soft);
  color: var(--accent);
}

.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 0 0 12px;
  font-size: 12.5px;
  scrollbar-width: thin;
}

.back {
  margin: 0 10px 4px;
  padding: 2px 4px;
  border: none;
  background: none;
  font-size: 12px;
  color: var(--accent);
}

.resize {
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 5;
}

.resize:hover {
  background: linear-gradient(to right, transparent 2px, var(--border-strong) 2px, var(--border-strong) 3px, transparent 3px);
}
</style>
