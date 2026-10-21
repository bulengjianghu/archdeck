<script setup lang="ts">
/**
 * 副栏（W-4、G15）：分屏的第二块。标题栏为收起、页签「时序图」（运行视角）「源代码」（有预览文件时，可关闭）、分屏方向切换；
 * 内容为时序图或源代码预览。页签与预览文件由项目视图持有，只属于这块界面。左右排列时收起即缩成一条竖栏。
 */
import { computed } from 'vue'
import SequenceView from '../sequence/SequenceView.vue'
import SourceView from '../source/SourceView.vue'
import type { AsideTab } from './useAside'

const props = defineProps<{ collapsed: boolean; dir: 'row' | 'column'; tab: AsideTab; run: boolean; previewPath: string | null }>()
const emit = defineEmits<{ toggle: []; direction: [dir: 'row' | 'column']; tab: [tab: AsideTab]; close: [] }>()
const strip = computed(() => props.collapsed && props.dir === 'row')
const fileName = computed(() => props.previewPath?.split('/').pop() ?? '')
const title = computed(() => (props.tab === 'source' ? '源代码' : '时序图'))
</script>

<template>
  <section v-if="strip" class="aside strip" :title="`展开${title}`" @click="emit('toggle')">
    <button class="fold">◂</button>
    <strong>{{ title }}</strong>
  </section>
  <section v-else class="aside" :class="[{ collapsed }, dir]">
    <header class="bar" role="tablist">
      <button class="fold" :title="collapsed ? '展开副栏' : '收起副栏'" @click="emit('toggle')">{{ collapsed ? '▸' : dir === 'row' ? '▸' : '▾' }}</button>
      <button v-if="run" role="tab" class="tab" :class="{ on: tab === 'sequence' }" :aria-selected="tab === 'sequence'" @click="emit('tab', 'sequence')">时序图</button>
      <span v-if="previewPath" class="tab-wrap" :class="{ on: tab === 'source' }">
        <button role="tab" class="tab" :class="{ on: tab === 'source' }" :aria-selected="tab === 'source'" :title="previewPath" @click="emit('tab', 'source')">
          源代码 · {{ fileName }}
        </button>
        <button class="close" title="关闭预览" @click="emit('close')">×</button>
      </span>
      <button class="dir" :title="dir === 'row' ? '改为上下排列' : '改为左右排列'" @click="emit('direction', dir === 'row' ? 'column' : 'row')">
        {{ dir === 'row' ? '⇅ 上下' : '⇆ 左右' }}
      </button>
    </header>
    <div v-if="!collapsed" class="content">
      <SourceView v-if="tab === 'source' && previewPath" :path="previewPath" />
      <SequenceView v-else-if="run" />
    </div>
  </section>
</template>

<style scoped>
.aside {
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
