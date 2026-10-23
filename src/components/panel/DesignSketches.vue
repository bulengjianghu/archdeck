<script setup lang="ts">
/**
 * 设计面板的草图列表（present.panel.design，F-2、F-10，X9、X20）：设计的各张草图——挂载点、模块数、脏标记（● 改过未保存）、
 * 推出未写文件的标「推出」；点一张切过去（当前张高亮）。设计还没有根草图时给「改骨架」：在会话里按基线推出根草图（改了才写出，F-3）。
 */
import { computed } from 'vue'
import { ROOT_MOUNT } from '@/model'
import { useDesk } from '@/state/inject'

const emit = defineEmits<{ note: [text: string] }>()
const desk = useDesk()
const e = desk.edit
const sheets = computed(() => e.sheets.value)
const hasRoot = computed(() => sheets.value.some(s => s.mount === ROOT_MOUNT))
function go(mount: string) {
  const r = e.goUp(mount)
  emit('note', r.ok ? '' : r.reason)
}
</script>

<template>
  <div class="design-sketches" data-testid="design-sketches">
    <p class="cap">本设计的草图 {{ sheets.length }} 张</p>
    <ul>
      <li v-for="s in sheets" :key="s.mount" :class="{ on: s.current }">
        <button class="row" :data-mount="s.mount" :title="s.mount" @click="go(s.mount)">
          <span class="nm">{{ s.name }}</span>
          <code class="mt">{{ s.mount }}</code>
          <span class="n">{{ s.modules }} 个模块</span>
          <span v-if="!s.file" class="derived" title="会话里推出，改了才写出">推出</span>
          <span v-if="s.dirty" class="dot" title="改过，未保存">●</span>
        </button>
      </li>
    </ul>
    <button v-if="e.target?.kind === 'design' && !hasRoot" class="small" title="根挂载：层与第二级（supersedes 骨架），底稿从基线复制" @click="go(ROOT_MOUNT)">
      改骨架
    </button>
  </div>
</template>

<style scoped>
.cap {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-3);
}

ul {
  margin: 0 0 6px;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  padding: 3px 6px;
  border: none;
  background: none;
  text-align: left;
  border-radius: 5px;
  font-size: 12.5px;
}

.row:hover {
  background: var(--surface-2);
}

.on .row {
  background: var(--accent-soft);
  color: var(--accent);
}

.mt {
  grid-column: 1;
  grid-row: 2;
  font-size: 10.5px;
  color: var(--text-3);
}

.nm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.n,
.derived {
  font-size: 11px;
  color: var(--text-3);
}

.dot {
  color: var(--warning);
}
</style>
