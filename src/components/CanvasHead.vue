<script setup lang="ts">
/**
 * 画布页头（LY-5、LY-2，ADR-0064）：44px（含 1px 底线），与侧栏项目标题、视图区主语条底线对齐；取代全宽顶栏（LY-1、LY-16）。
 * 左起：面包屑（侧栏开关在竖栏顶格，负责人 2026-11-08 走查）；右侧：视角段「结构 ｜ 交互」与场景胶囊、「显示 ▾」、⌕、⋯（帮助）、视图区开关。
 * 只发意图：开合是工作区状态（侧栏 LY-3、视图区 LY-12），只由人开合。草图画布下没有面包屑、视角段与显示。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import Breadcrumb from './Breadcrumb.vue'
import PerspectiveSwitch from './PerspectiveSwitch.vue'
import DisplayMenu from './display/DisplayMenu.vue'
import SearchPalette from './SearchPalette.vue'
import MoreMenu from './MoreMenu.vue'
import ToolIcon from './shared/ToolIcon.vue'

const search = defineModel<boolean>('search', { required: true })
const desk = useDesk()
const ws = desk.workspace
const ready = computed(() => desk.status.value === 'ready')
const viewsOpen = computed(() => !ws.state.value.collapsed)
const toggleViews = () => ws.dispatch({ type: 'setCollapsed', collapsed: viewsOpen.value })
</script>

<template>
  <header class="canvas-head" data-head="canvas" aria-label="画布页头">
    <Breadcrumb v-if="ready" />
    <span class="spacer" />
    <PerspectiveSwitch v-if="ready && !desk.edit.active.value" />
    <!-- L49、TB-3：「显示 ▾」——没有画布记号的显示设置；有非默认设置时带一个点 -->
    <DisplayMenu v-if="ready && !desk.edit.active.value" />
    <button
      class="ib"
      data-search-toggle
      :class="{ on: search }"
      title="搜索模块（⌘K）"
      aria-label="搜索模块"
      :aria-expanded="search"
      @click="search = !search"
    >
      <ToolIcon name="search" />
    </button>
    <MoreMenu />
    <button
      class="ib views-toggle"
      :class="{ on: viewsOpen }"
      :aria-pressed="viewsOpen"
      :title="viewsOpen ? '收起视图区（专注地图）' : '展开视图区'"
      aria-label="视图区"
      @click="toggleViews"
    >
      <ToolIcon name="props" />
    </button>
    <SearchPalette v-if="ready" v-model:open="search" />
  </header>
</template>

<style scoped>
.canvas-head {
  position: relative;
  flex: none;
  box-sizing: border-box;
  height: var(--head-h, 44px);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  min-width: 0;
}

.canvas-head > * {
  flex-shrink: 0;
}

.canvas-head > :deep(.crumbs) {
  flex-shrink: 1;
}

.spacer {
  flex: 1 1 0;
  min-width: 8px;
}

.ib {
  width: 28px;
  height: 28px;
  border-radius: 6px;
}
</style>
