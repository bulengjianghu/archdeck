<script setup lang="ts">
/**
 * 副栏（W-4、G15）：分屏的第二块。只有一栏标题栏（ADR-0010）：收起、页签「时序图」（运行视角）「源代码」（有预览文件时，可关闭）、
 * 时序图页签下的本层不可见提示、「定位」与「图例」（时序图的箭头约定，ADR-0017）、分屏方向切换（当前层次已在面包屑中，不重复）；
 * 内容为时序图或源代码预览。页签与预览文件由项目视图持有，只属于这块界面。左右排列时收起即缩成一条竖栏。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import SequenceView from '../sequence/SequenceView.vue'
import SourceView from '../source/SourceView.vue'
import type { AsideTab } from './useAside'

const props = defineProps<{ collapsed: boolean; dir: 'row' | 'column'; tab: AsideTab; run: boolean; previewPath: string | null }>()
const emit = defineEmits<{ toggle: []; direction: [dir: 'row' | 'column']; tab: [tab: AsideTab]; close: [] }>()
const strip = computed(() => props.collapsed && props.dir === 'row')
const fileName = computed(() => props.previewPath?.split('/').pop() ?? '')
const title = computed(() => (props.tab === 'source' ? '源代码' : '时序图'))

const desk = useDesk()
const sequence = ref<InstanceType<typeof SequenceView>>()
const onSequence = computed(() => props.run && !(props.tab === 'source' && props.previewPath))
/** R11：当前帧在本层不可见 */
const hiddenCurrent = computed(() => !!desk.run.frame.value && desk.run.currentIndex.value === null)
/** 时序图图例浮层：再点「图例」或焦点移出即收起 */
const help = ref(false)
</script>

<template>
  <section v-if="strip" class="aside strip" :title="`展开${title}`" @click="emit('toggle')">
    <button class="fold">◂</button>
    <strong>{{ title }}</strong>
  </section>
  <section v-else class="aside" :class="[{ collapsed }, dir]">
    <header class="bar" role="tablist">
      <button class="fold" :title="collapsed ? '展开副栏' : '收起副栏'" @click="emit('toggle')">{{ collapsed ? '▸' : dir === 'row' ? '▸' : '▾' }}</button>
      <button v-if="run" role="tab" class="tab" :class="{ on: tab === 'sequence' }" :aria-selected="tab === 'sequence'" @click="emit('tab', 'sequence')">
        时序图
      </button>
      <span v-if="previewPath" class="tab-wrap" :class="{ on: tab === 'source' }">
        <button role="tab" class="tab" :class="{ on: tab === 'source' }" :aria-selected="tab === 'source'" :title="previewPath" @click="emit('tab', 'source')">
          源代码 · {{ fileName }}
        </button>
        <button class="close" title="关闭预览" @click="emit('close')">×</button>
      </span>
      <template v-if="onSequence && !collapsed">
        <span v-if="hiddenCurrent" class="hint">
          本层不可见：<button class="link" @click="desk.goTo(desk.run.frameLevel.value!)">到能看到它的层次</button>
        </span>
        <button class="locate" :disabled="desk.run.currentIndex.value === null" @click="sequence?.centerCurrent()">定位</button>
        <button class="help" title="时序图图例" aria-label="时序图图例" :aria-expanded="help" @click="help = !help" @blur="help = false">图例</button>
      </template>
      <button class="dir" :title="dir === 'row' ? '改为上下排列' : '改为左右排列'" @click="emit('direction', dir === 'row' ? 'column' : 'row')">
        {{ dir === 'row' ? '⇅ 上下' : '⇆ 左右' }}
      </button>
    </header>
    <div v-if="help && onSequence && !collapsed" class="seq-legend" role="note" aria-label="时序图图例">
      <div class="item">
        <svg viewBox="0 0 32 10">
          <line x1="1" y1="5" x2="26" y2="5" />
          <path d="M24,1 L31,5 L24,9 z" class="solid" /></svg
        >同步调用（实线、实心箭头）
      </div>
      <div class="item">
        <svg viewBox="0 0 32 10">
          <line x1="1" y1="5" x2="27" y2="5" stroke-dasharray="6 4" />
          <path d="M24,1 L31,5 L24,9" class="open" /></svg
        >异步（虚线、开放箭头）
      </div>
      <div class="item">
        <svg viewBox="0 0 32 10">
          <line x1="1" y1="5" x2="27" y2="5" stroke-dasharray="2 3" />
          <path d="M24,1 L31,5 L24,9" class="open" /></svg
        >返回（点线）
      </div>
    </div>
    <div v-if="!collapsed" class="content">
      <SourceView v-if="tab === 'source' && previewPath" :path="previewPath" />
      <SequenceView v-else-if="run" ref="sequence" />
    </div>
  </section>
</template>

<style scoped>
.aside {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--surface);
  border-top: 1px solid var(--border);
}

.aside.row {
  border-top: none;
  border-left: 1px solid var(--border);
}

.strip {
  width: 30px;
  align-items: center;
  gap: 8px;
  padding-top: 6px;
  border-top: none;
  border-left: 1px solid var(--border);
  cursor: pointer;
  font-size: 12.5px;
}

.strip strong {
  writing-mode: vertical-rl;
  letter-spacing: 2px;
}

.bar {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  overflow: hidden;
  padding: 3px 10px 0;
  font-size: 12.5px;
  border-bottom: 1px solid var(--border);
  flex: none;
}

.fold,
.close {
  border: none;
  background: none;
  padding: 0 4px;
}

.close {
  color: var(--text-3);
}

.tab-wrap {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.tab {
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: none;
  padding: 3px 8px 5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab.on {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--warning);
}

.locate {
  margin-left: auto;
  flex: none;
  font-size: 11.5px;
  padding: 1px 8px;
  margin-bottom: 3px;
}

.locate:disabled {
  opacity: 0.4;
}

.locate + .help {
  margin-left: 4px;
}

.help {
  flex: none;
  font-size: 11.5px;
  padding: 1px 8px;
  margin-bottom: 3px;
}

.help + .dir {
  margin-left: 4px;
}

.seq-legend {
  position: absolute;
  top: 34px;
  right: 10px;
  z-index: 10;
  padding: 6px 10px;
  font-size: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 6px 20px rgb(0 0 0 / 12%);
}

.seq-legend .item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
  white-space: nowrap;
}

.seq-legend svg {
  flex: none;
  width: 32px;
  height: 10px;
  overflow: visible;
}

.seq-legend line,
.seq-legend .open {
  fill: none;
  stroke: var(--text-2);
  stroke-width: 1.5;
}

.seq-legend .solid {
  fill: var(--text-2);
}

.dir {
  margin-left: auto;
  flex: none;
  font-size: 11.5px;
  padding: 1px 6px;
  margin-bottom: 3px;
}

.collapsed .bar {
  border-bottom: none;
}

.content {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
