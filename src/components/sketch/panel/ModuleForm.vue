<script setup lang="ts">
/**
 * 草图面板 · 模块（present.panel.sketch，F-41，X7c、X10、X11、T1 裁决 10）：名称、ID（前缀固定、短名可改，前缀与唯一由模型层校验，改基线模块的 ID 记 from）、
 * 一句话职责、核心、封闭、代码落点（目录级）——文字字段失焦或回车提交一步，值未变不提交（X7g）；血缘只读「来自 A、B · 合并 / 拆分 / 改 ID / 移动」；
 * 对内的原则只读（属挂在它身上的下一层草图）；对外接口增删；「进入下一层 →」、合并（多选时）/ 拆分 / 删除经画布的对话框。
 */
import { computed, ref, watch } from 'vue'
import type { ModuleDef } from '@/model'
import { useDesk } from '@/state/inject'
import { CHANGE_BADGES } from '../labels'
import { requestSketch } from '../actions'

const props = defineProps<{ module: ModuleDef }>()
const emit = defineEmits<{ note: [text: string] }>()
const desk = useDesk()
const e = desk.edit
const m = computed(() => props.module)
const prefix = computed(() => m.value.id.slice(0, m.value.id.lastIndexOf('.') + 1))
const shortOf = (id: string) => id.slice(id.lastIndexOf('.') + 1)

const name = ref('')
const short = ref('')
const resp = ref('')
const code = ref('')
const newIf = ref('')
watch(
  m,
  x => {
    name.value = x.name ?? ''
    short.value = shortOf(x.id)
    resp.value = x.responsibility ?? ''
    code.value = (x.codeRefs ?? []).join(', ')
  },
  { immediate: true },
)
function report(r: { ok: boolean; reason?: string }) {
  emit('note', r.ok ? '' : (r.reason ?? ''))
  return r.ok
}
function commitName() {
  const v = name.value.trim()
  if (!v) return void (name.value = m.value.name)
  if (v !== m.value.name) report(e.updateModule(m.value.id, { name: v }))
}
function commitId() {
  const v = short.value.trim()
  if (v && v !== shortOf(m.value.id) && !report(e.rename(m.value.id, v))) short.value = shortOf(m.value.id)
}
function commitResp() {
  if (resp.value.trim() !== (m.value.responsibility ?? '')) report(e.updateModule(m.value.id, { responsibility: resp.value.trim() || undefined }))
}
const codeList = computed(() =>
  code.value
    .split(/[,，\n]/)
    .map(x => x.trim())
    .filter(Boolean),
)
/** 目录级（议，外部评审 D1）：看起来指向单个文件（有扩展名、不以 / 或 ** 结尾）的提示一句 */
const fileLike = computed(() => codeList.value.filter(x => /\.[a-z0-9]+$/i.test(x) && !x.endsWith('**')))
function commitCode() {
  const now = codeList.value
  if (now.join('\n') !== (m.value.codeRefs ?? []).join('\n')) report(e.updateModule(m.value.id, { codeRefs: now.length ? now : undefined }))
}
const closed = computed(() => !!e.sketch.value?.closed?.includes(m.value.id))
const setCore = (v: boolean) => report(e.updateModule(m.value.id, { core: v || undefined }))
const setClosed = (v: boolean) => report(e.edit({ op: 'setClosed', id: m.value.id, closed: v }))

// ── 血缘与原则 ──
const lineage = computed(() => e.lineageOf(m.value.id))
const from = computed(() => (m.value.from ?? []).filter(x => x !== m.value.id))
const principle = computed(() => e.principleOf(m.value.id))

// ── 对外接口（X10）──
const ifaces = computed(() => e.lookup.interfaces(m.value.id))
function addIf() {
  const v = newIf.value.trim()
  if (v && report(e.edit({ op: 'addInterface', owner: m.value.id, name: v }))) newIf.value = ''
}
const removeIf = (id: string) => report(e.edit({ op: 'removeInterface', id }))

const blur = (ev: KeyboardEvent) => (ev.target as HTMLElement).blur()
</script>

<template>
  <div class="skp-body" data-testid="sketch-module-form">
    <h3>{{ m.name || '（未命名）' }}</h3>
    <span class="cap"
      >模块 · <code>{{ m.id }}</code></span
    >
    <label class="f">名称 <input v-model="name" name="module-name" @blur="commitName" @keydown.enter="blur" /></label>
    <label class="f">
      <span class="lab"
        >ID <span class="muted">（前缀 {{ prefix }}，唯一）</span></span
      >
      <span class="id-row">
        <code>{{ prefix }}</code>
        <input v-model="short" name="module-id" @blur="commitId" @keydown.enter="blur" />
      </span>
    </label>
    <label class="f">
      <span class="lab">一句话职责 <span class="muted">（对外的一面，属本张）</span></span>
      <textarea v-model="resp" name="module-responsibility" rows="2" placeholder="它对外负责什么（底稿不复制职责文字）" @blur="commitResp" />
    </label>
    <div class="f checks">
      <label><input type="checkbox" name="module-core" :checked="!!m.core" @change="setCore(($event.target as HTMLInputElement).checked)" /> 核心</label>
      <label
        ><input type="checkbox" name="module-closed" :checked="closed" @change="setClosed(($event.target as HTMLInputElement).checked)" /> 封闭
        <span class="muted">（直接子模块必须与下一层草图相等）</span></label
      >
    </div>
    <label class="f">
      <span class="lab">代码落点 <span class="muted">（目录级，逗号分隔）</span></span>
      <input v-model="code" name="module-code" placeholder="src/state/desk/**" @blur="commitCode" @keydown.enter="blur" />
      <span v-if="fileLike.length" class="warn small">像是文件：{{ fileLike.join('、') }}——草图只写目录级，细到文件由 AI 补</span>
    </label>
    <div v-if="from.length || lineage" class="f">
      <span class="lab">血缘 <span class="muted">（只读）</span></span>
      <p class="ro" data-testid="module-lineage">
        <template v-if="from.length">来自 {{ from.map(x => e.nameOf(x) ?? x).join('、') }}</template>
        <template v-if="lineage"> · {{ CHANGE_BADGES[lineage].title }}</template>
      </p>
    </div>
    <div v-if="principle" class="f">
      <span class="lab">原则 <span class="muted">（对内的一面，属下一层草图，只读）</span></span>
      <p class="ro">{{ principle.text }}<span v-if="principle.from === 'current'" class="from">取自当前版本</span></p>
    </div>
    <div class="f">
      <span class="lab">对外接口</span>
      <ul class="ifaces">
        <li v-for="x in ifaces" :key="x.id">
          <code>{{ x.name }}</code>
          <button class="mini danger" :title="`删除接口 ${x.id}`" @click="removeIf(x.id)">删</button>
        </li>
        <li v-if="!ifaces.length" class="muted">没有</li>
      </ul>
      <span class="id-row">
        <input v-model="newIf" name="interface-name" placeholder="接口名，如 save" @keydown.enter.prevent="addIf" />
        <button class="small" :disabled="!newIf.trim()" @click="addIf">＋ 接口</button>
      </span>
    </div>
    <p v-if="lineage === 'merged'" class="info small">双击这个节点进入，继续设计它的内部。</p>
    <div class="actions">
      <button class="small" @click="report(e.openChild(m.id))">进入下一层 →</button>
      <button class="small" @click="requestSketch({ kind: 'split', ids: [m.id] })">拆分…</button>
      <button class="small danger" @click="requestSketch({ kind: 'remove', ids: [m.id] })">删除</button>
    </div>
    <p class="muted small">合并：⇧ 多选两个以上，右键或在面板里「合并为新模块…」</p>
  </div>
</template>
