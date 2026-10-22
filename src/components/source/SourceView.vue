<script setup lang="ts">
/**
 * 源代码预览（SR-8、G17）：只读显示预览文件——路径、归属模块、行数，按扩展名高亮的代码与行号。
 * 过大、二进制、文件不存在、源码清单读取失败时只给提示；没有编辑、保存等 IDE 功能。
 * 带目标行时滚到该行并标出（S18：步骤面板的候选调用点）。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import { highlightCode } from '../shared/highlight'
import { markLine } from './markLine'

const props = defineProps<{ path: string; line?: number }>()
const desk = useDesk()
/** 太长的文件不高亮（高亮在主线程，几十万字符会卡住界面），仍带行号显示 */
const HIGHLIGHT_LIMIT = 200_000

const res = computed(() => (desk.files.payload.value?.status === 'local' ? desk.files.file(props.path).value : null))
const file = computed(() => (res.value?.status === 'ok' ? res.value.value : null))
const text = computed(() => (file.value && 'text' in file.value ? file.value.text : null))
const lines = computed(() => (text.value === null ? 0 : text.value.split('\n').length))
const owners = computed(() => desk.files.ownership.value?.owners.get(props.path) ?? [])
const status = computed(() => {
  const p = props.path
  if (desk.files.ownership.value?.ignored.has(p)) return '已忽略'
  if (desk.files.ownership.value?.unowned.includes(p)) return '未归属'
  return owners.value.length > 1 ? '归属冲突' : ''
})

const html = ref<string | null>(null)
watchEffect(async () => {
  const t = text.value
  const f = file.value
  html.value = null
  if (t === null || !f || !('lang' in f) || t.length > HIGHLIGHT_LIMIT) return
  try {
    const out = await highlightCode(t, f.lang)
    if (t === text.value) html.value = out
  } catch {
    /* 高亮失败时保留纯文本 */
  }
})
const plainLines = computed(() => (text.value ?? '').split('\n'))
/** S18：目标行在渲染内容里标出（高亮结果的第 N 个 span.line 加 target），不靠事后改 DOM */
const shown = computed(() => (html.value ? markLine(html.value, props.line) : null))
/** 内容渲染好或目标行变化后滚到目标行；副栏刚出现、尚未排好版（高为 0）时等排好版再滚 */
const body = ref<HTMLElement | null>(null)
let pending = false
function revealLine() {
  const root = body.value
  const el = root?.querySelector<HTMLElement>('.line.target')
  pending = !!el && root!.clientHeight === 0
  if (el && !pending) el.scrollIntoView({ block: 'center' })
}
watch([shown, text, () => props.line], () => nextTick(revealLine), { flush: 'post', immediate: true })
// 测试环境（jsdom）没有 ResizeObserver
const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => pending && revealLine())
watch(body, (el, old) => {
  if (old) resized?.unobserve(old)
  if (el) resized?.observe(el)
})
onBeforeUnmount(() => resized?.disconnect())
const kb = (n: number) => `${Math.round(n / 1024)} KB`
</script>

<template>
  <section class="source-view">
    <header class="info">
      <code class="path" :title="path">{{ path }}</code>
      <span v-if="text !== null" class="muted">{{ lines }} 行</span>
      <span v-for="o in owners" :key="o" class="owner">
        <button class="link" @click="desk.revealModule(o)">{{ moduleName(desk.index.value!, o) }}</button>
      </span>
      <span v-if="status" class="badge" :class="{ warn: status !== '已忽略' }">{{ status }}</span>
      <span class="badge ro">只读</span>
    </header>
    <div ref="body" class="body">
      <p v-if="desk.files.payload.value?.status !== 'local'" class="source-note" :class="{ err: desk.files.payload.value }">
        {{ desk.files.payload.value?.status === 'error' ? desk.files.payload.value.reason : '正在读取源码清单…' }}
      </p>
      <p v-else-if="!res || res.status === 'loading'" class="hint">正在读取…</p>
      <p v-else-if="res.status === 'missing'" class="hint">文件不在源码清单中（可能已删除或改名）。</p>
      <p v-else-if="res.status === 'error'" class="hint warn">读取失败：{{ res.message }}</p>
      <p v-else-if="file && 'tooLarge' in file" class="hint">文件过大（{{ kb(file.tooLarge) }}），不预览。</p>
      <p v-else-if="file && 'binary' in file" class="hint">二进制文件，不预览。</p>
      <!-- eslint-disable-next-line vue/no-v-html -- shiki 输出，已转义源码 -->
      <div v-else-if="shown" class="code-view" v-html="shown" />
      <pre
        v-else
        class="code-view plain"
      ><code><span v-for="(l, i) in plainLines" :key="i" class="line" :class="{ target: i + 1 === line }">{{ l }}</span></code></pre>
    </div>
  </section>
</template>

<style scoped>
.source-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 5px 10px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  flex: none;
}

.path {
  font-size: 12px;
  word-break: break-all;
}

.badge {
  font-size: 11px;
  padding: 0 7px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--text-2);
  border: 1px solid var(--border);
}

.badge.warn {
  background: var(--warning-soft);
  color: var(--warning);
  border-color: transparent;
}

.badge.ro {
  margin-left: auto;
}

.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.hint {
  margin: 16px;
  color: var(--text-2);
  font-size: 13px;
}

.hint.warn {
  color: var(--warning);
}
</style>

<style>
/* 行号：Shiki 每行一个 span.line，纯文本兜底同样如此 */
.code-view pre,
.code-view.plain {
  margin: 0;
  padding: 8px 0;
  background: var(--surface) !important;
  font-size: 12.5px;
  line-height: 1.55;
  counter-reset: line;
  min-width: max-content;
}

.code-view code {
  display: block;
}

.code-view .line {
  display: inline-block;
  min-width: 100%;
  padding-right: 16px;
}

.code-view.plain .line {
  display: block;
}

/* S18：目标行 */
.code-view .line.target {
  background: var(--accent-soft);
}

.code-view .line::before {
  counter-increment: line;
  content: counter(line);
  display: inline-block;
  width: 4.5em;
  padding-right: 1.2em;
  text-align: right;
  color: var(--text-3);
  user-select: none;
}

@media (prefers-color-scheme: dark) {
  .code-view .shiki,
  .code-view .shiki span {
    color: var(--shiki-dark) !important;
  }
}
/* G1：源码在本地是前提，读不到清单是配置错误 */
.source-note {
  margin: 0;
  padding: 10px 14px;
  font-size: 12.5px;
  color: var(--text-2);
  word-break: break-all;
}

.source-note.err {
  color: var(--danger);
}
</style>
