<script setup lang="ts">
/** 演化面板的提交列表：哈希、日期、标题；展开一条按需取完整提交说明（source/<项目>/commit.json），可限定只显示本模块涉及的文件 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'

const props = defineProps<{ hashes: readonly string[]; limit?: number; moduleFiles?: ReadonlySet<string> }>()
const desk = useDesk()
const open = ref<string | null>(null)
const shown = computed(() => props.hashes.slice(0, props.limit ?? props.hashes.length))
const commitOf = (h: string) => desk.evolution.commitOf(h)
const message = (h: string) => desk.evolution.commitMessage(h).value
const messageText = (h: string): string | null => {
  const r = message(h)
  return r.status === 'ok' ? r.value.message : null
}
const filesOf = (h: string) => (commitOf(h)?.files ?? []).filter(f => !props.moduleFiles || props.moduleFiles.has(f.path))
</script>

<template>
  <ul class="plain commits">
    <li v-for="h in shown" :key="h" :class="{ fix: commitOf(h)?.fix }">
      <button class="row" :aria-expanded="open === h" @click="open = open === h ? null : h">
        <code :title="h">{{ commitOf(h)?.short ?? h.slice(0, 7) }}</code>
        <span class="date muted">{{ commitOf(h)?.date }}</span>
        <span class="subject">{{ commitOf(h)?.subject ?? '' }}</span>
        <span v-if="commitOf(h)?.fix" class="tag" title="缺陷修复提交（按标题判定）">修复</span>
      </button>
      <div v-if="open === h" class="detail">
        <pre v-if="messageText(h) !== null" class="message">{{ messageText(h) }}</pre>
        <p v-else-if="message(h).status === 'loading'" class="muted">正在读取提交说明…</p>
        <p v-else class="muted">读不到提交说明</p>
        <ul v-if="filesOf(h).length" class="plain files">
          <li v-for="f in filesOf(h)" :key="f.path">
            <button class="link" @click="desk.selectFile(f.path)">{{ f.path }}</button>
            <span class="muted"> +{{ f.added }} −{{ f.deleted }}</span>
          </li>
        </ul>
      </div>
    </li>
    <li v-if="hashes.length > shown.length" class="muted more">另 {{ hashes.length - shown.length }} 次</li>
  </ul>
</template>

<style scoped>
.commits li {
  padding: 2px 0;
}

.row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
}

.row code {
  flex: none;
  font-size: 11.5px;
  color: var(--text-3);
}

.date {
  flex: none;
  font-size: 11.5px;
}

.subject {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag {
  flex: none;
  font-size: 10.5px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--warning-soft);
  color: var(--warning);
}

.detail {
  margin: 4px 0 6px 10px;
}

.message {
  margin: 0 0 4px;
  padding: 6px 8px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--surface-2);
  border-radius: 6px;
}

.files {
  font-size: 12px;
}

.more {
  font-size: 12px;
}
</style>
