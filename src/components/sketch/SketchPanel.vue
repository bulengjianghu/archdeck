<script setup lang="ts">
/**
 * 草图面板（present.panel.sketch，SK-17，F-40–F-46，ADR-0025）：草图画布下的属性面板。顶部两级校验、常驻「待重连 N 条」与本张的两个核验数；
 * 下面按选中分派——多选：列出并可合并；本层模块：模块表单；根草图的层：层表单；关系：关系表单；引用节点：只读与精确关系；
 * 没有选中：非根草图为父模块（名称与职责只读、原则可编辑），根草图为设计概览（各张草图、全设计计数）；最后是草图元信息。
 */
import { computed, ref } from 'vue'
import { ROOT_MOUNT, type ChangeKind } from '@/model'
import { useDesk } from '@/state/inject'
import { CHANGE_BADGES } from './labels'
import { requestSketch } from './actions'
import ChecksSection from './panel/ChecksSection.vue'
import ParentSection from './panel/ParentSection.vue'
import ModuleForm from './panel/ModuleForm.vue'
import LayerForm from './panel/LayerForm.vue'
import RelationForm from './panel/RelationForm.vue'
import ReferenceSection from './panel/ReferenceSection.vue'
import MetaSection from './panel/MetaSection.vue'
import DesignSketches from '../panel/DesignSketches.vue'

const desk = useDesk()
const e = desk.edit
const sel = computed(() => desk.selection.value)
const own = computed(() => (sel.value?.kind === 'module' ? e.lookup.module(sel.value.id) : undefined))
const isLayer = computed(() => !!own.value && e.mount.value === ROOT_MOUNT && !own.value.id.includes('.'))
const refId = computed(() => (sel.value?.kind === 'module' && !own.value ? sel.value.id : null))
const relation = computed(() => (sel.value?.kind === 'relation' ? e.lookup.relation(sel.value.id) : undefined))
const picked = computed(() => e.picked.value)
const root = computed(() => e.mount.value === ROOT_MOUNT)
const note = ref('')
const onNote = (t: string) => (note.value = t)

/** 设计概览：全设计六类计数（改 ID 并入修改，T1 裁决 2） */
const SIX: { label: string; kinds: ChangeKind[] }[] = [
  { label: '新增', kinds: ['added'] },
  { label: '修改', kinds: ['changed', 'renamed'] },
  { label: '合并', kinds: ['merged'] },
  { label: '拆分', kinds: ['split'] },
  { label: '移动', kinds: ['moved'] },
  { label: '删除', kinds: ['removed'] },
]
const countsOf = (c: Record<ChangeKind, number> | undefined) => SIX.map(x => ({ label: x.label, n: x.kinds.reduce((a, k) => a + (c?.[k] ?? 0), 0) }))
const designName = computed(() => desk.versions.design.value?.name ?? e.session.value?.id ?? '')
</script>

<template>
  <div class="sk-panel" data-testid="sketch-panel">
    <ChecksSection />

    <section v-if="picked.length > 1" class="skp-body">
      <h3>已选 {{ picked.length }} 个</h3>
      <ul class="plain">
        <li v-for="id in picked" :key="id">{{ e.nameOf(id) ?? id }}</li>
      </ul>
      <div class="actions">
        <button class="small" @click="requestSketch({ kind: 'merge', ids: [...picked] })">合并为新模块…</button>
        <button class="small danger" @click="requestSketch({ kind: 'remove', ids: [...picked] })">删除所选</button>
      </div>
    </section>
    <LayerForm v-else-if="own && isLayer" :key="`l:${own.id}`" :layer="own" @note="onNote" />
    <ModuleForm v-else-if="own" :key="`m:${own.id}`" :module="own" @note="onNote" />
    <ReferenceSection v-else-if="refId" :id="refId" :key="`x:${refId}`" @note="onNote" />
    <RelationForm v-else-if="relation" :key="`r:${relation.id}`" :relation="relation" @note="onNote" />
    <template v-else-if="root">
      <section class="skp-body" data-testid="design-overview">
        <h3>{{ designName }} <span class="muted small">设计概览</span></h3>
        <p class="cap">全设计 · 相对基线</p>
        <ul class="counts">
          <li v-for="c in countsOf(e.vsBaseline.value?.counts)" :key="c.label" :class="{ zero: !c.n }">
            {{ c.label }} <b>{{ c.n }}</b>
          </li>
        </ul>
        <p class="cap">全设计 · 相对当前版本</p>
        <ul class="counts">
          <li v-for="c in countsOf(e.vsCurrent.value?.counts)" :key="c.label" :class="{ zero: !c.n }">
            {{ c.label }} <b>{{ c.n }}</b>
          </li>
        </ul>
      </section>
      <section class="skp-body"><DesignSketches @note="onNote" /></section>
    </template>
    <template v-else>
      <ParentSection @note="onNote" />
      <section class="skp-body"><DesignSketches @note="onNote" /></section>
    </template>
    <p v-if="note" class="err" role="alert">{{ note }}</p>
    <MetaSection @note="onNote" />
    <p class="legend muted small">
      角标：<template v-for="k in ['added', 'changed', 'merged', 'split', 'moved'] as const" :key="k"
        >{{ CHANGE_BADGES[k].text }} {{ CHANGE_BADGES[k].title }} ·
      </template>
    </p>
  </div>
</template>

<style scoped>
.sk-panel {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
}

.err {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}

.plain {
  margin: 0;
  padding-left: 16px;
}

.counts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 0 0 6px;
  padding: 0;
  list-style: none;
  font-size: 12px;
}

.counts .zero {
  color: var(--text-3);
}

.legend {
  margin: 0;
}
</style>

<style>
/* 草图面板各节共用的表单样式 */
.skp-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skp-body h3 {
  margin: 0;
  font-size: 15px;
}

.skp-body .cap {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}

.skp-body .f {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--text-2);
}

.skp-body .f.checks {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 4px 14px;
}

.skp-body .ro {
  margin: 0;
  padding: 4px 6px;
  font-size: 12.5px;
  color: var(--text);
  background: var(--surface-2);
  border-radius: 5px;
  white-space: pre-wrap;
}

.skp-body .from {
  margin-left: 6px;
  padding: 0 4px;
  font-size: 10.5px;
  color: var(--warning);
  border: 1px solid var(--warning);
  border-radius: 4px;
}

.skp-body .id-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.skp-body .id-row input {
  flex: 1;
  min-width: 0;
}

.skp-body .inline {
  display: flex;
  align-items: center;
  gap: 4px;
}

.skp-body .ifaces,
.skp-body .rels {
  margin: 0;
  padding-left: 16px;
}

.skp-body .rels .link {
  border: none;
  background: none;
  padding: 0;
  text-align: left;
  color: var(--text);
  cursor: pointer;
}

.skp-body .tiny {
  display: block;
  font-size: 10.5px;
}

.skp-body .actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.skp-body .small,
.sk-panel .small {
  font-size: 12px;
}

.skp-body .muted,
.sk-panel .muted {
  color: var(--text-3);
}

.skp-body .warn {
  color: var(--warning);
}

.skp-body .info {
  margin: 0;
  padding: 4px 6px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 5px;
}

.skp-body .danger {
  color: var(--danger);
}

.skp-body .mini {
  font-size: 10.5px;
  padding: 0 5px;
  margin-left: 6px;
}
</style>
