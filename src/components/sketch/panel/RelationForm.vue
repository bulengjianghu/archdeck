<script setup lang="ts">
/**
 * 草图面板 · 关系（present.panel.sketch，F-42）：起点 → 终点只读；类型、说明、经由接口（终点提供的接口，草图里的与当前版本里的），
 * 改动一步；改成同对同类型重复时模型层拒绝并就地说明。待重连的关系标出。
 */
import { computed, ref, watch } from 'vue'
import { RELATION_TYPES, type RelationDef, type RelationType } from '@/model'
import { useDesk } from '@/state/inject'
import { RELATION_TYPE_LABELS } from '../../shared/labels'
import { requestSketch } from '../actions'

const props = defineProps<{ relation: RelationDef }>()
const emit = defineEmits<{ note: [text: string] }>()
const desk = useDesk()
const e = desk.edit
const r = computed(() => props.relation)
const desc = ref('')
watch(r, x => (desc.value = x.description ?? ''), { immediate: true })
const name = (id: string) => e.nameOf(id) ?? id
function report(x: { ok: boolean; reason?: string }) {
  emit('note', x.ok ? '' : (x.reason ?? ''))
  return x.ok
}
const setType = (t: RelationType) => t !== r.value.type && report(e.edit({ op: 'updateRelation', id: r.value.id, patch: { type: t } }))
function commitDesc() {
  if (desc.value.trim() !== (r.value.description ?? '')) report(e.edit({ op: 'updateRelation', id: r.value.id, patch: { description: desc.value.trim() } }))
}
/** 终点提供的接口：本张里的与当前版本里的 */
const targetIfaces = computed(() => {
  const own = e.lookup.interfaces(r.value.to).map(x => x.id)
  const cur = [...(e.currentIndex.value?.interfaces.values() ?? [])].filter(x => x.owner === r.value.to).map(x => x.id)
  return [...new Set([...own, ...cur, ...(r.value.interface ? [r.value.interface] : [])])]
})
const setIf = (v: string) => v !== (r.value.interface ?? '') && report(e.edit({ op: 'updateRelation', id: r.value.id, patch: { interface: v } }))
const pending = computed(() => e.pending.value.includes(r.value.id))
const blur = (ev: KeyboardEvent) => (ev.target as HTMLElement).blur()
</script>

<template>
  <div class="skp-body" data-testid="sketch-relation-form">
    <h3>关系</h3>
    <span class="cap"
      ><code>{{ r.id }}</code></span
    >
    <div class="f">
      <span class="lab">起点 → 终点 <span class="muted">（只读）</span></span>
      <p class="ro">{{ name(r.from) }} → {{ name(r.to) }}</p>
      <p v-if="pending" class="warn small">待重连：一端已不在本层，重连或删除</p>
    </div>
    <label class="f">
      类型
      <select :value="r.type" name="relation-type" @change="setType(($event.target as HTMLSelectElement).value as RelationType)">
        <option v-for="t in RELATION_TYPES" :key="t" :value="t">{{ RELATION_TYPE_LABELS[t] }}（{{ t }}）</option>
      </select>
    </label>
    <label class="f">说明 <input v-model="desc" name="relation-description" placeholder="一句话" @blur="commitDesc" @keydown.enter="blur" /></label>
    <label class="f">
      经由接口
      <select :value="r.interface ?? ''" name="relation-interface" @change="setIf(($event.target as HTMLSelectElement).value)">
        <option value="">（不经由接口）</option>
        <option v-for="x in targetIfaces" :key="x" :value="x">{{ x }}</option>
      </select>
    </label>
    <p class="muted small">选中后可拖动画布上的标签调整位置。</p>
    <div class="actions">
      <button class="small danger" @click="requestSketch({ kind: 'remove', ids: [r.id] })">删除关系</button>
    </div>
  </div>
</template>
