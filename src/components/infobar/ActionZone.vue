<script setup lang="ts">
/**
 * 信息条的动作区（F-61，E-1–E-3、SK-6、SK-9、DV-10，ADR-0024、ADR-0025）：
 * - 提交版本 / 设计轮次：说明（根层的设计说明与变更清单）；
 * - 草图（打开即编辑，X7a）：保存（⌘S）、撤销 / 重做、保存并交给 AI（没有未保存改动时为「交给 AI」；全设计有格式错误或语义提示时禁用，F-52）、
 *   说明（全设计变更清单按血缘分组的弹层，F-53；持久草图另有一节「交给 AI 时的改动摘要」——与去掉这张草图贡献后的当前版本比，不进计数，X17）、退出（脏时三选保存 / 放弃 / 取消，退出回到进入草图之前的版本，#20b、leave.ts）；
 * - 文件已在外部改动：整个区换成横幅「重新加载并重放 / 放弃本次改动」，重放有失败时列出失败的操作。
 * ⌘S 与撤销 / 重做的快捷键由草图画布处理；输入框里的 ⌘S 在这里接：先失焦提交，再保存。
 * 窄屏（< 1100px）按钮只剩图标，名称在 aria-label 与 title 里。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDesk } from '@/state/inject'
import { ask } from '../edit/useEditDialog'
import { confirmLeave, leaveSketch } from '../edit/leave'
import ChangeGroups from './ChangeGroups.vue'

const props = defineProps<{ mode: 'commit' | 'round' | 'sketch' }>()
const desk = useDesk()
const router = useRouter()
const e = desk.edit
const note = ref('')
const failed = ref<string[]>([])
const copied = ref(false)
const handing = ref(false)
const notesOpen = ref(false)
const notesRoot = ref<HTMLElement>()
const editing = computed(() => props.mode === 'sketch' && e.active.value)
const errors = computed(() => e.designErrors.value.length)
const warnings = computed(() => e.designWarnings.value.length)
const noteTitle = computed(() =>
  props.mode === 'commit' ? '变更清单（根层面板）' : props.mode === 'sketch' ? '全设计的变更清单（按血缘分组）' : '设计说明与变更清单',
)
/** F-52：有格式错误或语义提示时禁用，悬停说明原因 */
const handBlocked = computed(() =>
  errors.value
    ? `有 ${errors.value} 个格式错误（见面板顶部，${e.designErrors.value[0].message}），改正后才能交给 AI`
    : warnings.value
      ? `有 ${warnings.value} 个语义提示（见面板顶部，${e.designWarnings.value[0].message}），处理后才能交给 AI`
      : '',
)
const handTitle = computed(
  () =>
    handBlocked.value ||
    (e.dirty.value ? '先保存整个设计，再' : '') + '把各张草图全文、变更摘要与 04 §5「按草图扩展」一节作为指令复制到剪贴板，交给 AI 起草下一轮',
)

function flash(text: string) {
  note.value = text
  setTimeout(() => note.value === text && (note.value = ''), 3000)
}

function showNotes() {
  if (props.mode === 'sketch') return void (notesOpen.value = !notesOpen.value)
  const idx = desk.index.value
  if (idx) desk.goTo(idx.rootId, null)
}

async function save(): Promise<boolean> {
  if (errors.value) return (flash(`有 ${errors.value} 个格式错误，先改正再保存`), false)
  const r = await e.save()
  const dropped = r.ok ? r.dropped.flatMap(d => d.ids) : []
  flash(
    r.ok
      ? dropped.length
        ? `已保存（丢掉没有关系的引用：${dropped.join('、')}）`
        : '已保存'
      : r.conflict
        ? '文件已变，重新加载并重放后再保存'
        : `保存失败：${r.error}`,
  )
  return r.ok
}

/** F-52、#20a：保存并交给 AI 一步（有未保存改动时先保存并重新读入，指令带上刚保存的草图） */
async function handToAi() {
  handing.value = true
  try {
    const r = await e.saveAndHandToAi()
    if (!r.ok) return flash(r.reason)
    await navigator.clipboard.writeText(r.prompt)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    copied.value = false
    flash('复制到剪贴板失败')
  } finally {
    handing.value = false
  }
}

/** X7a、#20b：脏时三选（保存 / 放弃 / 取消，与切换版本同一个对话框）；退出回到进入草图之前的版本 */
async function exit() {
  if (!(await confirmLeave(e, 'exit', flash))) return
  e.exit(true)
  leaveSketch(router, desk.project!)
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

/** 输入框里的 ⌘S（画布不接输入框里的按键）：先让正在输入的字段失焦提交，再保存 */
async function onKey(ev: KeyboardEvent) {
  if (!e.active.value || !(ev.metaKey || ev.ctrlKey) || ev.key.toLowerCase() !== 's') return
  const t = ev.target as HTMLElement | null
  if (!t?.closest?.('input, textarea, select, [contenteditable="true"]')) return
  ev.preventDefault()
  t.blur?.()
  await nextTick()
  if (e.dirty.value && !e.stale.value) void save()
}
function onDocDown(ev: MouseEvent) {
  if (notesOpen.value && notesRoot.value && !notesRoot.value.contains(ev.target as Node)) notesOpen.value = false
}
function onEsc(ev: KeyboardEvent) {
  if (!notesOpen.value || ev.key !== 'Escape') return
  ev.stopImmediatePropagation()
  notesOpen.value = false
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('keydown', onEsc, true)
  document.addEventListener('mousedown', onDocDown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keydown', onEsc, true)
  document.removeEventListener('mousedown', onDocDown)
})
</script>

<template>
  <div class="actions" aria-label="动作">
    <div v-if="editing && e.stale.value" class="stale" role="alert">
      <span>文件已变：</span>
      <button @click="replay">重新加载并重放</button>
      <button @click="discard">放弃本次改动</button>
    </div>
    <template v-else>
      <template v-if="editing">
        <button
          class="save"
          :class="{ primary: e.dirty.value }"
          aria-label="保存"
          title="保存整个设计（⌘S）"
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
        <span class="hand-wrap" :title="handTitle">
          <button
            class="hand"
            :aria-label="e.dirty.value ? '保存并交给 AI' : '交给 AI'"
            :disabled="!!handBlocked || handing || e.saving.value"
            @click="handToAi"
          >
            <span class="ico">✦</span><span class="txt">{{ copied ? '已复制指令' : e.dirty.value ? '保存并交给 AI' : '交给 AI' }}</span>
          </button>
        </span>
      </template>
      <span ref="notesRoot" class="notes-wrap">
        <button aria-label="说明" :title="noteTitle" :aria-expanded="mode === 'sketch' ? notesOpen : undefined" @click="showNotes">
          <span class="ico">ⓘ</span><span class="txt">说明</span>
        </button>
        <div v-if="notesOpen && mode === 'sketch'" class="pop" role="dialog" aria-label="变更清单">
          <p v-if="desk.versions.design.value?.goal" class="goal">{{ desk.versions.design.value.goal }}</p>
          <p class="cap">
            全设计 · {{ e.compareMode.value === 'baseline' ? '相对基线' : '相对当前版本' }}
            <span v-if="e.baselineFallback.value && e.compareMode.value === 'baseline'" class="muted">（没有基线提交，即相对当前版本）</span>
          </p>
          <ChangeGroups :view="e.comparison.value" :name-of="e.nameOf" />
          <section v-if="e.handoff.value" class="handoff" data-testid="handoff-summary">
            <p class="cap">交给 AI 时的改动摘要 <span class="muted">与去掉这张草图后的当前版本比，不是偏差</span></p>
            <ChangeGroups :view="e.handoff.value" :name-of="e.nameOf" />
          </section>
        </div>
      </span>
      <button v-if="editing" class="ghost" aria-label="退出" title="退出草图，回到进入草图之前的版本" @click="exit">
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

.hand {
  border-color: var(--accent);
  color: var(--accent);
}

.hand-wrap,
.notes-wrap {
  display: inline-flex;
}

.notes-wrap {
  position: relative;
}

.pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  width: 380px;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgb(0 0 0 / 14%);
  font-size: 12.5px;
  white-space: normal;
}

.goal {
  margin: 0 0 6px;
  color: var(--text);
}

.cap {
  margin: 0 0 6px;
  font-size: 11.5px;
  color: var(--text-2);
}

.handoff {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
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
