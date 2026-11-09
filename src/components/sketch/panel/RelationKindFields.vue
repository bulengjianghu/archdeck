<script setup lang="ts">
/**
 * X23：连线的类型与修饰——类型选查 / 托 / 通知 / 流（三问定类型；迁移期的 calls 显示「待分类」，可改不可新选），
 * 机制选直接 / 端口（再选端口）/ 总线（再选 role: bus 的模块）/ 通道（填通道名），修饰：异步（查询 / 委托）、拉取（流）。
 * 新建连线（ConnectPopover）与草图面板的关系（RelationForm）共用；每次改动 emit 一份补丁，由调用方提交。
 */
import { computed, ref, watch } from 'vue'
import { INTERACTION_TYPES, isCallLike, parseVia, type RelationModifiers, type RelationType } from '@/model'
import { useDesk } from '@/state/inject'
import { RELATION_TYPE_HINTS, RELATION_TYPE_LABELS, RELATION_TYPE_SHORT, VIA_KIND_HINTS, VIA_KIND_LABELS } from '../../shared/labels'

const props = defineProps<{
  type: RelationType
  via?: string
  mode?: 'sync' | 'async'
  pull?: boolean
  /** 终点：端口候选把终点子树里的排在前面 */ to: string
}>()
const emit = defineEmits<{ change: [patch: { type?: RelationType } & RelationModifiers] }>()
const desk = useDesk()
const e = desk.edit

type Kind = 'direct' | 'port' | 'bus' | 'channel' | 'legacy'
const parsed = computed(() => parseVia(props.via))
const kind = ref<Kind>('direct')
const target = ref('')
watch(
  () => props.via,
  () => {
    kind.value = props.via === undefined ? 'direct' : (parsed.value?.kind ?? 'legacy')
    target.value = parsed.value?.target ?? ''
  },
  { immediate: true },
)
const inTarget = (owner?: string) => !!owner && (owner === props.to || owner.startsWith(`${props.to}.`))
const ports = computed(() => [...e.lookup.ports.value].sort((a, b) => Number(inTarget(b.owner)) - Number(inTarget(a.owner)) || a.id.localeCompare(b.id)))
const buses = computed(() => e.lookup.buses.value)
const name = (id: string) => e.nameOf(id) ?? id

function setKind(k: Kind) {
  kind.value = k
  target.value = k === 'port' ? (ports.value[0]?.id ?? '') : k === 'bus' ? (buses.value[0] ?? '') : ''
  commitVia()
}
function commitVia() {
  const v = kind.value === 'direct' ? '' : kind.value === 'legacy' ? (props.via ?? '') : target.value.trim() ? `${kind.value}:${target.value.trim()}` : ''
  if (kind.value === 'channel' && !target.value.trim()) return
  if (v !== (props.via ?? '')) emit('change', { via: v })
}
const setType = (t: RelationType) => t !== props.type && emit('change', { type: t })
const asyncable = computed(() => isCallLike(props.type))
</script>

<template>
  <div class="kind-fields">
    <div class="f" role="radiogroup" aria-label="类型（三问）">
      <span class="lab">类型</span>
      <div class="types">
        <button
          v-for="t in INTERACTION_TYPES"
          :key="t"
          type="button"
          role="radio"
          class="type"
          :class="[`rel-${t}`, { on: type === t }]"
          :aria-checked="type === t"
          :data-type="t"
          :title="`${RELATION_TYPE_LABELS[t]}（${t}）：${RELATION_TYPE_HINTS[t]}`"
          @click="setType(t)"
        >
          {{ RELATION_TYPE_SHORT[t] }}
        </button>
        <span v-if="type === 'calls'" class="pending-type" title="迁移期的 calls：按三问定为查询或委托，写进草图即确认（X23）">待分类</span>
      </div>
      <p class="hint">{{ RELATION_TYPE_LABELS[type] }}：{{ RELATION_TYPE_HINTS[type] }}</p>
    </div>
    <label class="f">
      机制
      <select :value="kind" name="rel-via-kind" @change="setKind(($event.target as HTMLSelectElement).value as Kind)">
        <option v-for="k in ['direct', 'port', 'bus', 'channel'] as const" :key="k" :value="k" :title="VIA_KIND_HINTS[k]">{{ VIA_KIND_LABELS[k] }}</option>
        <option v-if="kind === 'legacy'" value="legacy">旧写法：{{ via }}</option>
      </select>
    </label>
    <label v-if="kind === 'port'" class="f">
      端口
      <select v-model="target" name="rel-via-port" @change="commitVia">
        <option v-for="p in ports" :key="p.id" :value="p.id">{{ p.name }}（{{ p.id }}{{ p.owner ? ` · ${name(p.owner)}` : '' }}）</option>
      </select>
    </label>
    <label v-else-if="kind === 'bus'" class="f">
      总线
      <select v-model="target" name="rel-via-bus" @change="commitVia">
        <option v-if="!buses.length" value="" disabled>没有 role: bus 的模块</option>
        <option v-for="b in buses" :key="b" :value="b">{{ name(b) }}（{{ b }}）</option>
      </select>
    </label>
    <label v-else-if="kind === 'channel'" class="f">
      通道名 <input v-model="target" name="rel-via-channel" placeholder="如 http、hmr、inject" @blur="commitVia" @keydown.enter.prevent="commitVia" />
    </label>
    <div class="mods">
      <label v-if="asyncable" class="check"
        ><input
          type="checkbox"
          name="rel-async"
          :checked="mode === 'async'"
          @change="emit('change', { mode: ($event.target as HTMLInputElement).checked ? 'async' : '' })"
        />
        异步</label
      >
      <span v-else-if="type === 'notifies'" class="muted">通知一律异步</span>
      <label v-if="type === 'streams'" class="check"
        ><input type="checkbox" name="rel-pull" :checked="!!pull" @change="emit('change', { pull: ($event.target as HTMLInputElement).checked })" /> 拉取</label
      >
    </div>
  </div>
</template>

<style scoped>
.kind-fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.f {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.types {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.type {
  padding: 2px 10px;
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border-strong, var(--border));
  border-radius: 12px;
  background: var(--surface);
  color: var(--rel);
}

.type.on {
  border-color: var(--rel);
  background: color-mix(in srgb, var(--rel) 14%, var(--surface));
  font-weight: 600;
}

.pending-type {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--warning);
  background: var(--warning-soft);
}

.hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-3);
}

.mods {
  display: flex;
  gap: 12px;
  font-size: 12px;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
</style>
