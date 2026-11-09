<script setup lang="ts">
/**
 * 名称 + ID 短名的输入（X7c、#13）：新建模块（双击空白就地输入，at 给出屏幕位置）、合并为新模块（一行）、拆分（若干行，可加行）。
 * 名称能转写为 kebab-case 时 ID 短名自动填、可改；中文名必须手填短名（不用拼音）。完整 ID = <前缀>.<短名>。回车提交，Esc 取消。
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { useDesk } from '@/state/inject'

const props = defineProps<{
  title: string
  /** 完整 ID 的前缀（挂载点；根草图新建层时为空） */
  prefix: string
  rows?: number
  /** 可以加行（拆分） */
  extendable?: boolean
  ok: string
  error?: string
  /** 就地输入：屏幕坐标（缺省为居中的对话框） */
  at?: { x: number; y: number }
  hint?: string
}>()
const emit = defineEmits<{ submit: [rows: { name: string; id: string }[]]; close: [] }>()
const desk = useDesk()

interface Row {
  name: string
  id: string
  /** 用户改过 ID 后不再自动填 */
  touched: boolean
}
const rows = ref<Row[]>(Array.from({ length: props.rows ?? 1 }, () => ({ name: '', id: '', touched: false })))
const first = ref<HTMLInputElement[] | null>(null)
onMounted(async () => {
  await nextTick()
  first.value?.[0]?.focus()
})

function onName(r: Row) {
  if (!r.touched) r.id = desk.edit.suggestShort(r.name)
}
const SHORT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const valid = computed(
  () => rows.value.every(r => r.name.trim() && SHORT.test(r.id.trim())) && new Set(rows.value.map(r => r.id.trim())).size === rows.value.length,
)
const missing = computed(() => rows.value.some(r => r.name.trim() && !r.id.trim()))

function submit() {
  if (valid.value)
    emit(
      'submit',
      rows.value.map(r => ({ name: r.name.trim(), id: r.id.trim() })),
    )
}
function onKey(e: KeyboardEvent) {
  e.stopPropagation()
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <div class="sk-dialog-mask" :class="{ inline: !!at }" @click.self="emit('close')">
    <form
      class="sk-dialog"
      role="dialog"
      :aria-label="title"
      :style="at ? { left: `${at.x}px`, top: `${at.y}px` } : undefined"
      @submit.prevent="submit"
      @keydown="onKey"
    >
      <h3>{{ title }}</h3>
      <div v-for="(r, i) in rows" :key="i" class="row">
        <input ref="first" v-model="r.name" name="part-name" placeholder="名称" @input="onName(r)" />
        <span class="prefix">{{ prefix ? `${prefix}.` : '' }}</span>
        <input v-model="r.id" name="part-id" placeholder="ID 短名" @input="r.touched = true" />
      </div>
      <button v-if="extendable" type="button" class="link add" @click="rows.push({ name: '', id: '', touched: false })">＋ 再加一个</button>
      <p v-if="missing" class="warn">名称不能转写为英文 ID 时请手填 ID 短名（如 session），不用拼音</p>
      <p v-if="hint" class="hint">{{ hint }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" @click="emit('close')">取消</button>
        <button type="submit" class="ok" :disabled="!valid">{{ ok }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.sk-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: grid;
  place-items: center;
  background: rgb(20 26 36 / 20%);
}

.sk-dialog-mask.inline {
  display: block;
  background: transparent;
}

.sk-dialog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 360px;
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 28px rgb(0 0 0 / 18%);
  font-size: 13px;
}

.inline .sk-dialog {
  position: fixed;
}

h3 {
  margin: 0;
  font-size: 13.5px;
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.row input {
  min-width: 0;
  flex: 1;
}

.prefix {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--text-3);
}

.add {
  align-self: flex-start;
  font-size: 12px;
}

.warn,
.hint,
.error {
  margin: 0;
  font-size: 12px;
}

.warn {
  color: var(--warning);
}

.hint {
  color: var(--text-3);
}

.error {
  color: var(--danger);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ok:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
</style>
