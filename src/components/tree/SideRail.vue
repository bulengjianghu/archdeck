<script setup lang="ts">
/**
 * 侧栏竖栏（LY-3、LY-4，负责人 2026-11-08 走查）：最左边一条 44px 竖栏，侧栏收起时它还在。
 * 顶部 44px 一格放侧栏开关（底线与三区页头的线连成一条，LY-2），下面是「模块」「场景」「改动」三页的图标，悬停显示名称；
 * 「场景」在草图编辑时不可用，「改动」只在设计的草图编辑时可用（CI-4）。
 * 点当前页的图标收起侧栏；点另一页的图标展开侧栏并切到那一页（只由人开合，LY-3）。只发意图：开合是工作区状态，页属于界面（SIDE_NAV）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { useSideNav, type SidePage } from '../shared/navTab'
import ToolIcon from '../shared/ToolIcon.vue'

const desk = useDesk()
const ws = desk.workspace
const { page } = useSideNav()
const open = computed(() => ws.state.value.sidebar.open)
const ready = computed(() => desk.status.value === 'ready')
/** CI-4：改动页只在设计的草图画布下 */
const hasChanges = computed(() => desk.edit.active.value && desk.edit.target?.kind === 'design')
const changeCount = computed(() => (hasChanges.value ? desk.edit.changes.items.value.length : 0))
const PAGES: { key: SidePage; label: string }[] = [
  { key: 'modules', label: '模块' },
  { key: 'scenes', label: '场景' },
  { key: 'changes', label: '改动' },
]
const disabled = (k: SidePage) => !ready.value || (k === 'scenes' && desk.edit.active.value) || (k === 'changes' && !hasChanges.value)
const title = (k: SidePage, label: string) =>
  k === 'changes' && !hasChanges.value ? '改动（编辑设计的草图时可用）' : k === 'scenes' && desk.edit.active.value ? '场景（草图编辑时不可用）' : label
const toggle = () => ws.dispatch({ type: 'setSidebar', open: !open.value })
function pick(k: SidePage) {
  if (open.value && page.value === k) {
    ws.dispatch({ type: 'setSidebar', open: false })
    return
  }
  page.value = k
  if (!open.value) ws.dispatch({ type: 'setSidebar', open: true })
}
</script>

<template>
  <nav class="side-rail" aria-label="侧栏页" data-region="rail">
    <div class="top" data-head="rail">
      <button class="ri side-toggle" :class="{ on: open }" :aria-pressed="open" :title="open ? '收起侧栏' : '展开侧栏'" aria-label="侧栏" @click="toggle">
        <ToolIcon name="nav" />
      </button>
    </div>
    <button
      v-for="p in PAGES"
      :key="p.key"
      class="ri page"
      :class="{ on: open && page === p.key }"
      :aria-pressed="open && page === p.key"
      :aria-label="p.label"
      :title="title(p.key, p.label)"
      :disabled="disabled(p.key)"
      :data-rail="p.key"
      @click="pick(p.key)"
    >
      <ToolIcon :name="p.key" />
      <span v-if="p.key === 'changes' && changeCount" class="count">{{ changeCount }}</span>
    </button>
  </nav>
</template>

<style scoped>
.side-rail {
  flex: none;
  width: 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.top {
  flex: none;
  box-sizing: border-box;
  width: 100%;
  height: var(--head-h, 44px);
  display: grid;
  place-items: center;
  border-bottom: 1px solid var(--border);
}

.ri {
  position: relative;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: none;
  color: var(--text-3);
}

.ri.page {
  margin-top: 6px;
}

.ri:hover:not(:disabled) {
  color: var(--text);
  background: var(--surface-2);
}

.ri.on {
  color: var(--text);
  background: var(--surface-3);
}

.ri:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ri :deep(.tool-icon) {
  width: 17px;
  height: 17px;
}

.count {
  position: absolute;
  top: 1px;
  right: 0;
  min-width: 14px;
  padding: 0 3px;
  border-radius: 7px;
  font-size: 10px;
  line-height: 14px;
  background: var(--accent);
  color: var(--surface);
}
</style>
