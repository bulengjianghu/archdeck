<script setup lang="ts">
/**
 * 资料区的一组（WS-4–WS-7）：第一行是标签栏（与工具栏同高），下面是活动标签的内容。
 * 预览标签标题斜体，双击固定；单击组内即聚焦该组（新资料进焦点组）。上组的标签栏右端有「⊟ 分屏 / 取消分屏」与 ✕。
 * 只读工作区状态、只发意图（desk.workspace.dispatch）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import type { DocGroup, DocTab } from '@/state/useDeskState'
import SourceView from '../source/SourceView.vue'
import SequenceDoc from './SequenceDoc.vue'

const props = defineProps<{ group: DocGroup; gi: number; count: number; focused: boolean }>()
const desk = useDesk()
const ws = desk.workspace
const active = computed(() => props.group.tabs.find(t => t.id === props.group.active) ?? null)

function label(t: DocTab): string {
  const d = t.doc
  if (d.kind === 'sequence') return `时序图${desk.run.scenario.value ? ` · ${desk.run.scenario.value.name}` : ''}`
  if (d.kind === 'source') return `源代码 · ${d.path.split('/').pop()}`
  return `图解 · ${desk.index.value?.modules.get(d.module)?.name ?? d.module}`
}
const tip = (t: DocTab) => (t.doc.kind === 'source' ? t.doc.path : label(t)) + (t.preview ? '（预览：双击固定）' : '')
</script>

<template>
  <section class="group" :class="{ focused: focused && count > 1 }" :data-group="gi" @pointerdown="ws.dispatch({ type: 'focusGroup', group: gi })">
    <header class="tabs" role="tablist" :aria-label="count > 1 ? `资料 · ${gi === 0 ? '上' : '下'}组` : '资料'">
      <span
        v-for="t in group.tabs"
        :key="t.id"
        class="tab"
        :class="{ on: t.id === group.active, preview: t.preview }"
        :data-doc="t.id"
        @dblclick="ws.dispatch({ type: 'pin', group: gi, id: t.id })"
      >
        <button role="tab" class="lbl" :aria-selected="t.id === group.active" :title="tip(t)" @click="ws.dispatch({ type: 'activate', group: gi, id: t.id })">
          {{ label(t) }}
        </button>
        <button class="x" :title="`关闭${label(t)}`" :aria-label="`关闭${label(t)}`" @click.stop="ws.dispatch({ type: 'close', group: gi, id: t.id })">
          ×
        </button>
      </span>
      <span class="sp" />
      <template v-if="gi === 0">
        <button v-if="count === 1" class="icon" title="上下分屏：之后打开的资料放进下组" :disabled="!group.tabs.length" @click="ws.dispatch({ type: 'split' })">
          ⊟ 分屏
        </button>
        <button v-else class="icon" title="取消分屏：下组的标签并回上组" @click="ws.dispatch({ type: 'unsplit' })">取消分屏</button>
        <button class="icon close-all" title="关闭资料区（关闭全部标签）" aria-label="关闭资料区" @click="ws.dispatch({ type: 'closeDock' })">✕</button>
      </template>
    </header>
    <div class="body">
      <template v-if="active">
        <SourceView v-if="active.doc.kind === 'source'" :key="active.id" :path="active.doc.path" :line="active.doc.line ?? undefined" />
        <template v-else-if="active.doc.kind === 'sequence'">
          <SequenceDoc v-if="desk.perspective.value === 'run'" />
          <p v-else class="empty">没有打开的场景</p>
        </template>
        <p v-else class="empty">图解（第十七轮 W5）</p>
      </template>
      <p v-else class="empty">从场景、文件或面板里的「预览」打开一份资料，放进这一组</p>
    </div>
  </section>
</template>

<style scoped>
.group {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.group + .group {
  border-top: 3px solid var(--border);
}

.tabs {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: var(--toolbar-h);
  padding: 0 6px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  flex: none;
  overflow-x: auto;
  overflow-y: hidden;
  font-size: 12.5px;
}

.focused .tabs {
  box-shadow: inset 0 2px 0 var(--accent);
}

.tab {
  display: inline-flex;
  align-items: center;
  flex: none;
  max-width: 220px;
  margin-bottom: -1px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  color: var(--text-2);
}

.tab.on {
  background: var(--surface);
  border-color: var(--border);
  color: var(--text);
}

.tab .lbl {
  border: none;
  background: none;
  padding: 5px 4px 6px 9px;
  color: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab.on .lbl {
  font-weight: 600;
}

.tab.preview .lbl {
  font-style: italic;
}

.tab .x {
  border: none;
  background: none;
  padding: 0 6px 0 2px;
  color: var(--text-3);
}

.sp {
  flex: 1;
}

.icon {
  flex: none;
  align-self: center;
  border: none;
  background: none;
  font-size: 12px;
  color: var(--text-2);
  padding: 2px 6px;
}

.icon:disabled {
  opacity: 0.4;
}

.body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
}

.empty {
  margin: 0;
  padding: 30px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 12.5px;
}
</style>
