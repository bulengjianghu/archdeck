<script setup lang="ts">
/**
 * 信息条的动作区（F-61，E-1–E-3、SK-6、SK-9、DV-10，ADR-0024）：
 * - 提交版本 / 设计轮次：说明（根层的设计说明与变更清单）；
 * - 草图查看态：编辑、交给 AI（只有设计的草图有指令）、说明；
 * - 草图编辑态：保存（⌘S）、撤销 / 重做、保存并交给 AI（有校验错误时禁用）、说明、退出（脏时三选保存 / 放弃 / 取消，退出回到进入草图之前的版本，#20b）；
 * - 文件已在外部改动：整个区换成横幅「重新加载并重放 / 放弃本次改动」，重放有失败时列出失败的操作。
 * 窄屏（< 1100px）按钮只剩图标，名称在 aria-label 与 title 里。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDesk } from '@/state/inject'
import { ask, choose } from '../edit/useEditDialog'

const props = defineProps<{ mode: 'commit' | 'round' | 'sketch'; back?: string }>()
const desk = useDesk()
const route = useRoute()
const router = useRouter()
const e = desk.edit
const note = ref('')
const failed = ref<string[]>([])
const copied = ref(false)
const errors = computed(() => e.validation.value?.issues.filter(i => i.severity === 'error').length ?? 0)
/** DV-10：只有设计的草图有「交给 AI」的指令 */
const canHand = computed(() => props.mode === 'sketch' && e.target?.kind === 'design')
const noteTitle = computed(() => (props.mode === 'commit' ? '变更清单（根层面板）' : props.mode === 'sketch' ? '草图说明与变更清单' : '设计说明与变更清单'))
const handTitle = computed(() =>
  errors.value
    ? `有 ${errors.value} 个校验错误（见面板顶部），改正后才能交给 AI`
    : '把草图全文、相对上一次提交的改动摘要与 04 §5「按草图扩展」一节作为指令复制到剪贴板，交给 AI 起草下一轮',
)

function flash(text: string) {
  note.value = text
  setTimeout(() => note.value === text && (note.value = ''), 3000)
}

function showNotes() {
  const idx = desk.index.value
  if (idx) desk.goTo(idx.rootId, null)
}

async function save(): Promise<boolean> {
  if (errors.value) return (flash(`有 ${errors.value} 个校验错误，先改正再保存`), false)
  const r = await e.save()
  flash(r.ok ? '已保存' : r.conflict ? '文件已变，重新加载后再改' : `保存失败：${r.error}`)
  return r.ok
}

/** DV-10、#20a：有未保存的改动时先保存（并重新读入，指令带上刚保存的草图），再把指令放进剪贴板 */
async function handToAi() {
  if (e.dirty.value) {
    if (!(await save())) return
    await desk.reload()
  }
  try {
    await navigator.clipboard.writeText(desk.versions.sketchPrompt.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    copied.value = false
  }
}

/** #20b：回到进入草图之前的版本；没有（直接打开的）或就是本版本时回当前版本 */
function leave() {
  const prev = props.back ? router.resolve(props.back) : null
  const same = prev && JSON.stringify(prev.params) === JSON.stringify(route.params)
  void router.push(prev && !same ? prev.fullPath : { name: 'project', params: { project: desk.project! } })
}

async function exit() {
  if (e.exitEdit() === 'confirm') {
    const a = await choose({ title: '有未保存的改动，退出编辑？', lines: ['保存后退出，或放弃改动退出'], ok: '保存', alt: '放弃' })
    if (a === 'cancel' || (a === 'ok' && !(await save()))) return
    e.exitEdit(true)
  }
  leave()
}

async function replay() {
  const r = await e.replayOnReload()
  failed.value = r.failed.map(op => JSON.stringify(op))
  flash(r.failed.length ? `${r.failed.length} 个操作重放失败` : '已重放到新文件上')
}

async function discard() {
  if (e.dirty.value && !(await ask({ title: '放弃本次未保存的改动？', lines: ['草图回到上次保存（或读取）时的内容'], ok: '放弃改动', danger: true }))) return
  failed.value = []
  await e.discard()
}

/** ⌘S：先让正在输入的字段失焦提交，再保存 */
async function onKey(ev: KeyboardEvent) {
  if (!e.active.value || !(ev.metaKey || ev.ctrlKey) || ev.key.toLowerCase() !== 's') return
  ev.preventDefault()
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  await nextTick()
  if (e.dirty.value && !e.stale.value) void save()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="actions" aria-label="动作">
    <div v-if="mode === 'sketch' && e.stale.value" class="stale" role="alert">
      <span>文件已变：</span>
      <button @click="replay">重新加载并重放</button>
      <button @click="discard">放弃本次改动</button>
    </div>
    <template v-else>
      <template v-if="mode === 'sketch' && e.active.value">
        <button
          class="save"
          :class="{ primary: e.dirty.value }"
          aria-label="保存"
          title="保存（⌘S）"
          :disabled="e.saving.value || !e.dirty.value"
          @click="save"
        >
          <span class="ico">⤓</span><span class="txt">保存 <kbd>⌘S</kbd></span>
        </button>
        <button class="icon" aria-label="撤销" title="撤销（⌘Z）" :disabled="!e.canUndo.value" @click="e.undo()">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3 2.5 6.5 6 10M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7" /></svg>
        </button>
        <button class="icon" aria-label="重做" title="重做（⇧⌘Z）" :disabled="!e.canRedo.value" @click="e.redo()">
          <svg class="mirror" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3 2.5 6.5 6 10M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7" /></svg>
        </button>
      </template>
      <button v-else-if="mode === 'sketch'" class="edit" aria-label="编辑" title="在画布上编辑这张草图（X7）" @click="e.enterEdit()">
        <span class="ico">✎</span><span class="txt">编辑</span>
      </button>
      <span v-if="canHand" class="hand-wrap" :title="handTitle">
        <button class="hand" :aria-label="e.dirty.value ? '保存并交给 AI' : '交给 AI'" :disabled="e.active.value && errors > 0" @click="handToAi">
          <span class="ico">✦</span><span class="txt">{{ copied ? '已复制指令' : e.dirty.value ? '保存并交给 AI' : '交给 AI' }}</span>
        </button>
      </span>
      <button aria-label="说明" :title="noteTitle" @click="showNotes"><span class="ico">ⓘ</span><span class="txt">说明</span></button>
      <button v-if="mode === 'sketch' && e.active.value" class="ghost" aria-label="退出" title="退出编辑，回到进入草图之前的版本" @click="exit">
        <span class="ico">✕</span><span class="txt">退出</span>
      </button>
    </template>
    <span v-if="failed.length" class="failed" :title="failed.join('\n')">重放失败 {{ failed.length }} 个操作</span>
    <span v-if="note" class="note" role="status">{{ note }}</span>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 2px 9px;
  white-space: nowrap;
}

.ico {
  display: none;
}

button.icon svg {
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

button.icon svg.mirror {
  transform: scaleX(-1);
}

button.icon {
  padding: 4px 7px;
  line-height: 1;
}

kbd {
  font-family: var(--mono);
  font-size: 10.5px;
  opacity: 0.75;
}

.primary:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

.edit,
.hand {
  border-color: var(--accent);
  color: var(--accent);
}

.hand-wrap {
  display: inline-flex;
}

.ghost {
  border-color: transparent;
  color: var(--text-2);
}

.stale {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 6px;
  color: var(--danger);
  background: var(--danger-soft);
  white-space: nowrap;
}

.failed {
  color: var(--danger);
  font-size: 12px;
  white-space: nowrap;
}

.note {
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
}

@media (width < 1100px) {
  .ico {
    display: inline;
  }

  .txt {
    display: none;
  }
}
</style>
