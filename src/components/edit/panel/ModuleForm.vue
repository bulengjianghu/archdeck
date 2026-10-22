<script setup lang="ts">
/**
 * 模块表单（P-2、P-4，X7d）：名称、ID（只改短名，父 ID 前缀只读；提交即父不变的移动，同一级联与确认）、职责、kind、核心（只第二级）、封闭、
 * 代码落点（目录级）、所属父（下拉，等价于移动）、对外接口。只在持久草图里的模块只读。
 */
import { computed } from 'vue'
import type { ModulePatch } from '@/model'
import { useDesk } from '@/state/inject'
import { confirmMove } from '../canvas/useEditDrag'
import { confirmRemove } from '../canvas/useEditKeys'
import Field from './Field.vue'
import InterfaceForm from './InterfaceForm.vue'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ notice: [msg: string] }>()
const desk = useDesk()
const e = desk.edit
const node = computed(() => e.lookup.module(props.id))
const entity = computed(() => desk.index.value?.modules.get(props.id))
const owner = computed(() => (node.value ? null : e.lookup.persistentOf(props.id)))
const parentId = computed(() => entity.value?.parentId ?? '')
const prefix = computed(() => (parentId.value && parentId.value !== desk.index.value?.rootId ? `${parentId.value}.` : ''))
const short = computed(() => (prefix.value ? props.id.slice(prefix.value.length) : props.id))
const secondLevel = computed(() => desk.index.value?.modules.get(parentId.value)?.kind === 'layer')
const closed = computed(() => !!e.draft.value?.closed?.includes(props.id))
/** 可作所属父的模块：不是自己与后代 */
const parents = computed(() => {
  const idx = desk.index.value
  if (!idx) return []
  return [...idx.modules.values()].filter(m => m.id !== props.id && !idx.pathOf.get(m.id)?.includes(props.id)).map(m => ({ id: m.id, name: m.name }))
})
const done = (r: { ok: boolean; reason?: string }) => !r.ok && emit('notice', r.reason ?? '')
const patch = (p: ModulePatch) => done(e.edit({ op: 'updateModule', id: props.id, patch: p }))

async function rename(v: string) {
  const next = `${prefix.value}${v.trim()}`
  if (!v.trim() || next === props.id) return
  const msg = await confirmMove(desk, props.id, parentId.value, next)
  if (msg) emit('notice', msg)
}
async function reparent(ev: Event) {
  const p = (ev.target as HTMLSelectElement).value
  const msg = p && p !== parentId.value ? await confirmMove(desk, props.id, p) : ''
  if (msg) emit('notice', msg)
  ;(ev.target as HTMLSelectElement).value = parentId.value
}
</script>

<template>
  <section class="form" data-testid="module-form">
    <h3>
      模块 <code>{{ id }}</code>
    </h3>
    <p v-if="owner" class="note">属于持久草图「{{ owner }}」：在设计草图里只读；要改它请编辑该持久草图，或声明 supersedes。</p>
    <template v-else-if="node">
      <Field label="名称" name="module-name" :value="node.name" @commit="v => patch({ name: v as string })" />
      <label class="field">
        <span class="label">ID（只改短名；换父用「所属父」）</span>
        <span class="id"
          ><span class="prefix">{{ prefix }}</span
          ><input name="module-id" :value="short" @change="ev => rename((ev.target as HTMLInputElement).value)" @keydown.stop
        /></span>
      </label>
      <Field label="职责" name="module-responsibility" :value="node.responsibility" multiline @commit="v => patch({ responsibility: v as string })" />
      <label class="field">
        <span class="label">kind</span>
        <select :value="node.kind ?? ''" @change="ev => patch({ kind: (ev.target as HTMLSelectElement).value })">
          <option value="">（不写）</option>
          <option value="subsystem">subsystem</option>
          <option value="component">component</option>
        </select>
      </label>
      <label v-if="secondLevel" class="check"
        ><input type="checkbox" :checked="!!node.core" @change="ev => patch({ core: (ev.target as HTMLInputElement).checked })" /> 核心（只用于第二级）</label
      >
      <label class="check"
        ><input type="checkbox" :checked="closed" @change="ev => done(e.edit({ op: 'setClosed', id, closed: (ev.target as HTMLInputElement).checked }))" />
        封闭（直接子模块必须与草图相等）</label
      >
      <Field label="代码落点（目录级 glob，逐行，可选）" :value="node.codeRefs" lines mono @commit="v => patch({ codeRefs: v as string[] })" />
      <label class="field">
        <span class="label">所属父（等价于移动，会改 ID）</span>
        <select name="module-parent" :value="parentId" @change="reparent">
          <option v-for="p in parents" :key="p.id" :value="p.id">{{ p.name }}（{{ p.id }}）</option>
        </select>
      </label>
      <InterfaceForm :owner="id" @notice="m => emit('notice', m)" />
      <button class="remove" @click="confirmRemove(desk, { kind: 'module', id }).then(m => m && emit('notice', m))">删除模块</button>
    </template>
  </section>
</template>

<style scoped src="./form.css"></style>
