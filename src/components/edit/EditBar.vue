<script setup lang="ts">
/**
 * 编辑信息条（E-1–E-3、SK-6、SK-9，ADR-0024）：草图版本上的「编辑」；编辑态下「编辑草图：<名>」、未保存标记 ●、
 * 保存 / 放弃 / 校验、撤销 / 重做；文件已在外部改动时「重新加载并重放」，重放有失败时列出失败的操作并给「放弃本次改动」。保存成功后停留在编辑态。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDesk } from '@/state/inject'
import { ask } from './useEditDialog'
import { leaveSketch } from './leave'

const props = defineProps<{ name: string }>()
const desk = useDesk()
const router = useRouter()
const e = desk.edit
const note = ref('')
const failed = ref<string[]>([])
const errors = computed(() => e.validation.value?.issues.filter(i => i.severity === 'error').length ?? 0)

function flash(text: string) {
  note.value = text
  setTimeout(() => note.value === text && (note.value = ''), 3000)
}

async function save() {
  if (errors.value) return flash(`有 ${errors.value} 个校验错误，先改正再保存`)
  const r = await e.save()
  const dropped = r.ok ? r.dropped.flatMap(d => d.ids) : []
  flash(
    r.ok
      ? dropped.length
        ? `已保存（丢掉没有关系的引用：${dropped.join('、')}）`
        : '已保存'
      : r.conflict
        ? '文件已变，重新加载后再改'
        : `保存失败：${r.error}`,
  )
}

async function discard() {
  if (e.dirty.value && !(await ask({ title: '放弃本次未保存的改动？', lines: ['草图回到上次保存（或读取）时的内容'], ok: '放弃改动', danger: true }))) return
  failed.value = []
  await e.discard()
}

/** F-15：退出回到进入草图之前的版本；有未保存改动时先确认 */
async function exit() {
  if (e.exit() === 'confirm') {
    if (!(await ask({ title: '有未保存的改动，退出草图？', lines: ['未保存的改动会丢失'], ok: '退出并丢弃', danger: true }))) return
    e.exit(true)
  }
  leaveSketch(router, desk.project!)
}

async function replay() {
  const r = await e.replayOnReload()
  failed.value = r.failed.map(op => JSON.stringify(op))
  flash(r.failed.length ? `${r.failed.length} 个操作重放失败` : '已重放到新文件上')
}

function check() {
  flash(errors.value ? `${errors.value} 个校验错误（见面板顶部）` : '校验通过')
}
</script>

<template>
  <span class="edit-bar">
    <template v-if="e.active.value">
      <span class="title">编辑草图：{{ props.name }}<span v-if="e.dirty.value" class="dot" title="有未保存的改动">●</span></span>
      <button :disabled="!e.canUndo.value" title="撤销（⌘Z）" @click="e.undo()">撤销</button>
      <button :disabled="!e.canRedo.value" title="重做（⇧⌘Z）" @click="e.redo()">重做</button>
      <button @click="check">校验</button>
      <button class="save" :disabled="e.saving.value || !e.dirty.value || e.stale.value" @click="save">保存</button>
      <button @click="discard">放弃</button>
      <button @click="exit">退出</button>
      <span v-if="e.stale.value" class="stale">
        文件已在外部改动
        <button @click="replay">重新加载并重放</button>
        <button @click="discard">放弃本次改动</button>
      </span>
      <span v-if="failed.length" class="failed" :title="failed.join('\n')">重放失败 {{ failed.length }} 个操作</span>
      <span v-if="note" class="note" role="status">{{ note }}</span>
    </template>
  </span>
</template>

<style scoped>
.edit-bar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.edit-bar button {
  font-size: 12px;
  padding: 1px 8px;
}

.edit {
  border-color: var(--accent);
  color: var(--accent);
}

.title {
  font-weight: 600;
}

.dot {
  margin-left: 4px;
  color: var(--warning);
}

.save:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

.stale,
.failed {
  color: var(--danger);
  font-size: 12px;
}

.note {
  font-size: 12px;
  color: var(--text-2);
}
</style>
