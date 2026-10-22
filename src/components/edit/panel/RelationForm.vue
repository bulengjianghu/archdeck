<script setup lang="ts">
/** 关系表单（P-3、C-10）：两端（只读，可定位）、类型、说明、经由接口（可选）；删除 */
import { computed } from 'vue'
import { RELATION_TYPES, type RelationType } from '@/model'
import { useDesk } from '@/state/inject'
import { RELATION_TYPE_LABELS } from '../../shared/labels'
import Field from './Field.vue'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ notice: [msg: string] }>()
const desk = useDesk()
const e = desk.edit
const r = computed(() => e.lookup.relation(props.id))
const interfaces = computed(() => [...(desk.index.value?.interfaces.values() ?? [])])
const name = (id: string) => desk.index.value?.modules.get(id)?.name ?? id
const done = (x: { ok: boolean; reason?: string }) => !x.ok && emit('notice', x.reason ?? '')
const upd = (patch: { type?: RelationType; description?: string; interface?: string }) => done(e.edit({ op: 'updateRelation', id: props.id, patch }))
</script>

<template>
  <section class="form" data-testid="relation-form">
    <h3>
      关系 <code>{{ id }}</code>
    </h3>
    <p v-if="!r" class="note">这条关系不在本草图里（属于持久草图），只读。</p>
    <template v-else>
      <p>
        <button class="link" @click="desk.revealModule(r.from)">{{ name(r.from) }}</button> →
        <button class="link" @click="desk.revealModule(r.to)">{{ name(r.to) }}</button>
      </p>
      <label class="field">
        <span class="label">类型</span>
        <select name="relation-type" :value="r.type" @change="ev => upd({ type: (ev.target as HTMLSelectElement).value as RelationType })">
          <option v-for="t in RELATION_TYPES" :key="t" :value="t">{{ RELATION_TYPE_LABELS[t] }}（{{ t }}）</option>
        </select>
      </label>
      <Field label="说明" name="relation-description" :value="r.description" @commit="v => upd({ description: v as string })" />
      <label class="field">
        <span class="label">经由接口（可选）</span>
        <select :value="r.interface ?? ''" @change="ev => upd({ interface: (ev.target as HTMLSelectElement).value })">
          <option value="">（不写）</option>
          <option v-for="x in interfaces" :key="x.id" :value="x.id">{{ x.name }}（{{ x.id }}）</option>
        </select>
      </label>
      <button class="remove" @click="done(e.edit({ op: 'removeRelation', id }))">删除关系</button>
    </template>
  </section>
</template>

<style scoped src="./form.css"></style>
