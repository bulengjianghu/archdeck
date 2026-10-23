<script setup lang="ts">
/**
 * 草图面板 · 层（present.panel.sketch，F-40 根挂载、X21）：根草图里选中层带——名称、ID、抽象原则（abstraction）、包含 / 不包含（一行一条）、
 * 可依赖的层（mayDependOn），失焦提交一步；「删层」经画布的级联确认。层是带不是层次：没有「进入下一层」。
 */
import { computed, ref, watch } from 'vue'
import type { ModuleDef } from '@/model'
import { useDesk } from '@/state/inject'
import { requestSketch } from '../actions'

const props = defineProps<{ layer: ModuleDef }>()
const emit = defineEmits<{ note: [text: string] }>()
const desk = useDesk()
const e = desk.edit
const l = computed(() => props.layer)
const name = ref('')
const id = ref('')
const abs = ref('')
const inc = ref('')
const exc = ref('')
watch(
  l,
  x => {
    name.value = x.name ?? ''
    id.value = x.id
    abs.value = x.abstraction ?? ''
    inc.value = (x.includes ?? []).join('\n')
    exc.value = (x.excludes ?? []).join('\n')
  },
  { immediate: true },
)
function report(r: { ok: boolean; reason?: string }) {
  emit('note', r.ok ? '' : (r.reason ?? ''))
  return r.ok
}
const lines = (s: string) =>
  s
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean)
function commitName() {
  const v = name.value.trim()
  if (v && v !== l.value.name) report(e.updateModule(l.value.id, { name: v }))
}
function commitId() {
  const v = id.value.trim()
  if (v && v !== l.value.id && !report(e.rename(l.value.id, v))) id.value = l.value.id
}
function commitAbs() {
  if (abs.value.trim() !== (l.value.abstraction ?? '')) report(e.updateModule(l.value.id, { abstraction: abs.value.trim() || undefined }))
}
function commitList(key: 'includes' | 'excludes', text: string) {
  const now = lines(text)
  if (now.join('\n') !== (l.value[key] ?? []).join('\n')) report(e.updateModule(l.value.id, { [key]: now.length ? now : undefined }))
}
const others = computed(() => (e.sketch.value?.modules ?? []).filter(m => m.id !== l.value.id))
function toggleDep(dep: string, on: boolean) {
  const cur = new Set(l.value.mayDependOn ?? [])
  if (on) cur.add(dep)
  else cur.delete(dep)
  report(e.edit({ op: 'setMayDependOn', id: l.value.id, layers: [...cur] }))
}
const blur = (ev: KeyboardEvent) => (ev.target as HTMLElement).blur()
</script>

<template>
  <div class="skp-body" data-testid="sketch-layer-form">
    <h3>{{ l.name }} <span class="muted small">层</span></h3>
    <span class="cap">{{ (l.children ?? []).length }} 个第二级模块</span>
    <label class="f">名称 <input v-model="name" name="layer-name" @blur="commitName" @keydown.enter="blur" /></label>
    <label class="f">ID <input v-model="id" name="layer-id" @blur="commitId" @keydown.enter="blur" /></label>
    <label class="f">
      <span class="lab">抽象原则 <span class="muted">（这一层管什么、按什么划界）</span></span>
      <textarea v-model="abs" name="layer-abstraction" rows="4" @blur="commitAbs" />
    </label>
    <label class="f">
      <span class="lab">包含 <span class="muted">（一行一条）</span></span>
      <textarea v-model="inc" name="layer-includes" rows="2" @blur="commitList('includes', inc)" />
    </label>
    <label class="f">
      <span class="lab">不包含 <span class="muted">（一行一条）</span></span>
      <textarea v-model="exc" name="layer-excludes" rows="2" @blur="commitList('excludes', exc)" />
    </label>
    <div class="f">
      <span class="lab">可依赖的层</span>
      <label v-for="o in others" :key="o.id" class="inline">
        <input type="checkbox" :checked="(l.mayDependOn ?? []).includes(o.id)" @change="toggleDep(o.id, ($event.target as HTMLInputElement).checked)" />
        {{ o.name }}
      </label>
    </div>
    <div class="actions">
      <button class="small danger" @click="requestSketch({ kind: 'remove', ids: [l.id] })">删层</button>
    </div>
  </div>
</template>
