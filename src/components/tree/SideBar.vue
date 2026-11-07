<script setup lang="ts">
/**
 * 侧栏（LY-3、LY-4，ADR-0064）：系统的名词，停靠在画布左边，可收起、可拖宽（开合与宽度是工作区状态、按本机记住，只由人开合）。
 * 页头 44px 是项目标题（项目菜单，LY-2，由项目视图摆在侧栏顶上）；其下三页——模块（树，根行 = 系统；「按模块 / 按文件」两种树，LY-4b）、
 * 场景（列表，单击进入回放；回放中先列这个场景的步骤，LY-4c）、改动（只在设计的草图编辑时可用，CI-4）。
 * 页只属于这块界面（SIDE_NAV，由项目视图持有），不进视图状态与 URL；进入回放切到「场景」页（只换页，不开合侧栏）。
 */
import { computed, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import { useSideNav } from '../shared/navTab'
import ScenarioList from '../ScenarioList.vue'
import ModuleTree from './ModuleTree.vue'
import StepTree from './StepTree.vue'
import FileTree from './FileTree.vue'
import ChangesTab from './ChangesTab.vue'
import SketchTree from '../sketch/SketchTree.vue'

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
    <div class="pages" role="tablist" aria-label="侧栏页">
      <button role="tab" :class="{ on: page === 'modules' }" :aria-selected="page === 'modules'" data-side-page="modules" @click="page = 'modules'">
        模块
      </button>
      <button
        role="tab"
        :class="{ on: page === 'scenes' }"
        :aria-selected="page === 'scenes'"
        data-side-page="scenes"
        :disabled="desk.edit.active.value"
        @click="page = 'scenes'"
      >
        场景
      </button>
      <button
        role="tab"
        class="changes-tab-btn"
        :class="{ on: page === 'changes' }"
        :aria-selected="page === 'changes'"
        data-side-page="changes"
        :disabled="!hasChanges"
        :title="hasChanges ? '这一份设计相对基线的改动' : '编辑设计的草图时可用'"
        @click="page = 'changes'"
      >
        改动<span v-if="hasChanges && desk.edit.changes.items.value.length" class="count">{{ desk.edit.changes.items.value.length }}</span>
      </button>
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
        <div class="mode" role="group" aria-label="树">
          <button :class="{ on: mode === 'modules' }" :aria-pressed="mode === 'modules'" @click="mode = 'modules'">按模块</button>
          <button :class="{ on: mode === 'files' }" :aria-pressed="mode === 'files'" data-side-mode="files" @click="mode = 'files'">按文件</button>
        </div>
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

.pages {
  flex: none;
  display: flex;
  gap: 2px;
  padding: 8px 10px 4px;
}

.pages button {
  padding: 3px 10px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-2);
  font-size: 12.5px;
}

.pages button:hover:not(:disabled) {
  color: var(--text);
}

.pages button.on {
  background: var(--surface-3);
  color: var(--text);
}

.pages button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
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
  padding: 4px 0 12px;
  font-size: 12.5px;
  scrollbar-width: thin;
}

.mode {
  display: flex;
  gap: 2px;
  padding: 0 10px 4px;
}

.mode button {
  padding: 1px 8px;
  border: none;
  border-radius: 5px;
  background: none;
  font-size: 11.5px;
  color: var(--text-3);
}

.mode button.on {
  color: var(--text);
  background: var(--surface-2);
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
  background: var(--border);
}
</style>
