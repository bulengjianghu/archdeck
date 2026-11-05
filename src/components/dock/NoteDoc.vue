<script setup lang="ts">
/**
 * 设计说明（DA-10、DL-10）：辅助栏的预览标签——对话里「存为设计说明」的回答，挂在设计下（designs/<设计>/notes/，AI 拥有）。
 * 标「目标态 · 未实现」：它讲的是草图要它变成的样子，实现后作为该模块题解的底稿。只读。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import Markdown from '../panel/Markdown.vue'

const props = defineProps<{ doc: { kind: 'note'; file: string } }>()
const desk = useDesk()
const note = computed(() => desk.notes.list.value.find(n => n.file === props.doc.file) ?? null)
/** 正文去掉文件头的标题与元信息行（卡头已显示） */
const body = computed(() =>
  (note.value?.text ?? '')
    .replace(/^#\s+.*\n/, '')
    .replace(/^\s*>\s*.*\n/, '')
    .trim(),
)
</script>

<template>
  <article class="note-doc" data-testid="note-doc">
    <header>
      <span class="badge" data-testid="note-target">目标态 · 未实现</span>
      <h3>{{ note?.title ?? doc.file }}</h3>
      <button v-if="note?.module" class="link" @click="desk.revealModule(note.module)">{{ note.module }}</button>
    </header>
    <Markdown v-if="note" :text="body" />
    <p v-else class="muted">这份设计说明已不在设计目录里。</p>
  </article>
</template>

<style scoped>
.note-doc {
  padding: 12px 14px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.7;
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
h3 {
  margin: 0;
  font-size: 14px;
}
.badge {
  padding: 0 8px;
  border-radius: 9px;
  font-size: 11px;
  background: var(--warn-soft, var(--surface-2));
  color: var(--warn, var(--text-2));
  border: 1px dashed var(--warn, var(--border));
}
.muted {
  color: var(--text-3);
}
.link {
  font-size: 12px;
}
</style>
