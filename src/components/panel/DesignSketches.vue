<script setup lang="ts">
/**
 * 设计面板的草图列表（present.panel.design，F-2、F-10，X9、X20）：设计的各张草图——挂载点、模块数、脏标记（● 改过未保存）、
 * 推出未写文件的标「推出」；点一张切过去（当前张高亮）。设计还没有根草图时给「改骨架」：在会话里按基线推出根草图（改了才写出，F-3）。
 * 「放弃设计」（DL-38，07 §3.1）：起草中与已认可时可放弃，二次确认；放弃后任务单作废、项目卡片不再列出，草图与对话保留、版本切换里仍可开。
 */
import { computed } from 'vue'
import { ROOT_MOUNT } from '@/model'
import { useDesk } from '@/state/inject'
import { ask } from '../edit/useEditDialog'

const emit = defineEmits<{ note: [text: string] }>()
const desk = useDesk()
const e = desk.edit
const sheets = computed(() => e.sheets.value)
const hasRoot = computed(() => sheets.value.some(s => s.mount === ROOT_MOUNT))
const canAbandon = computed(() => e.target?.kind === 'design' && ['draft', 'reviewing', 'accepted'].includes(e.approval.status.value ?? ''))
async function abandon() {
  if (
    !(await ask({
      title: `放弃设计「${desk.versions.design.value?.name ?? ''}」？`,
      lines: ['设计改为「已放弃」：只看，不能再改、认可或归档', '任务单作废；项目卡片不再列出这个设计', '草图、对话、设计说明原样保留，版本切换里仍可打开'],
      ok: '放弃设计',
      danger: true,
    }))
  )
    return
  const r = await e.approval.abandon()
  emit('note', r.ok ? '设计已放弃' : r.reason)
}
function go(mount: string) {
  const r = e.openMount(mount)
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
    <button v-if="canAbandon" class="small abandon" data-testid="abandon-design" title="放弃这个设计（二次确认）：任务单作废，草图与对话保留" @click="abandon">
      放弃设计
    </button>
    <!-- DA-10、DL-31：设计说明（AI 拥有，目标态 · 未实现）——单击在辅助栏打开预览标签 -->
    <template v-if="desk.notes.list.value.length">
      <p class="cap">设计说明 {{ desk.notes.list.value.length }} 份 <span class="tgt">目标态 · 未实现</span></p>
      <ul data-testid="design-notes">
        <li v-for="n in desk.notes.list.value" :key="n.file">
          <button class="row" :data-note="n.file" @click="desk.notes.open(n.file)">
            <span class="nm">{{ n.title }}</span>
            <code v-if="n.module" class="mt">{{ n.module }}</code>
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.abandon {
  margin-left: 6px;
  color: var(--danger);
}

.tgt {
  margin-left: 4px;
  font-size: 11px;
  color: var(--warning);
}

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
