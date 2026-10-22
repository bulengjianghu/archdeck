<script setup lang="ts">
/** 层表单（P-1）：名称、ID、职责、抽象原则、包含 / 不包含（逐行）、可依赖的层（多选，来源为草图与持久草图里的层）、封闭；删除层（连子树，二次确认） */
import { computed } from 'vue'
import type { ModulePatch } from '@/model'
import { useDesk } from '@/state/inject'
import { confirmRemove } from '../canvas/useEditKeys'
import Field from './Field.vue'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ notice: [msg: string] }>()
const desk = useDesk()
const e = desk.edit
const node = computed(() => e.lookup.module(props.id))
const owner = computed(() => (node.value ? null : e.lookup.persistentOf(props.id)))
const layers = computed(() => {
  const idx = desk.index.value
  return idx ? (idx.childrenOf.get(idx.rootId) ?? []).map(id => idx.modules.get(id)!).filter(m => m.kind === 'layer' && m.id !== props.id) : []
})
const closed = computed(() => !!e.draft.value?.closed?.includes(props.id))
const done = (r: { ok: boolean; reason?: string }) => !r.ok && emit('notice', r.reason ?? '')
const patch = (p: ModulePatch) => done(e.edit({ op: 'updateModule', id: props.id, patch: p }))
function toggleDep(layer: string, on: boolean) {
  const cur = node.value?.mayDependOn ?? []
  done(e.edit({ op: 'setMayDependOn', id: props.id, layers: on ? [...cur, layer] : cur.filter(x => x !== layer) }))
}
/** 根下的层没有父，改 ID 直接级联到子树（X7d） */
function rename(v: string) {
  if (!v.trim() || v.trim() === props.id) return
  done(e.edit({ op: 'renameModule', id: props.id, newId: v.trim() }))
}
</script>

<template>
  <section class="form" data-testid="layer-form">
    <h3>
      层 <code>{{ id }}</code>
    </h3>
    <p v-if="owner" class="note">属于持久草图「{{ owner }}」：在设计草图里只读；要改它请编辑该持久草图，或声明 supersedes。</p>
    <template v-else-if="node">
      <Field label="名称" name="layer-name" :value="node.name" @commit="v => patch({ name: v as string })" />
      <Field label="ID" name="layer-id" :value="node.id" mono @commit="v => rename(v as string)" />
      <Field label="职责" :value="node.responsibility" multiline @commit="v => patch({ responsibility: v as string })" />
      <Field label="抽象原则" :value="node.abstraction" multiline @commit="v => patch({ abstraction: v as string })" />
      <Field label="包含（逐行）" :value="node.includes" lines @commit="v => patch({ includes: v as string[] })" />
      <Field label="不包含（逐行）" :value="node.excludes" lines @commit="v => patch({ excludes: v as string[] })" />
      <fieldset class="field">
        <legend class="label">可依赖的层</legend>
        <label v-for="l in layers" :key="l.id" class="check">
          <input type="checkbox" :checked="!!node.mayDependOn?.includes(l.id)" @change="ev => toggleDep(l.id, (ev.target as HTMLInputElement).checked)" />
          {{ l.name }}
        </label>
      </fieldset>
      <label class="check"
        ><input type="checkbox" :checked="closed" @change="ev => done(e.edit({ op: 'setClosed', id, closed: (ev.target as HTMLInputElement).checked }))" />
        封闭（直接子模块必须与草图相等）</label
      >
      <button class="remove" @click="confirmRemove(desk, { kind: 'module', id }).then(m => m && emit('notice', m))">删除层</button>
    </template>
  </section>
</template>

<style scoped src="./form.css"></style>
