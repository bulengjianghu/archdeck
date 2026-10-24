<script setup lang="ts">
/**
 * 「显示」面板 · 结构边（结构视角，L16、L19）：四种结构边的 UML 记号（依赖、子类、端口实现、组装）与依赖的三档浓淡（K14）；
 * 组标题右侧是「只引类型」开关（读写显示偏好 typeOnly，缺省收起，L15），组内给出本层只引类型的依赖边条数（desk.facts.structure.typeOnly）。
 * 没有代码事实时（U16）只说明允许边。
 */
import { computed } from 'vue'
import { DEP_TIERS, STRUCTURE_KINDS } from '@/model'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import StructureSwatch from './StructureSwatch.vue'
import { useStructurePrefs } from './useDisplayPrefs'
import { DEP_TIER_HINT, DEP_TIER_LABEL, FACTS_HINT, STRUCTURE_KIND_HINT, STRUCTURE_KIND_LABEL } from './labels'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()
const sp = useStructurePrefs(desk.project)
const typeOnly = computed({ get: () => sp.prefs.value.typeOnly, set: sp.setTypeOnly })

const sv = computed(() => desk.facts.structure.value)
const facts = computed(() => desk.facts.status.value === 'ready')
/** 本层只引类型的依赖边条数（L15 画布角计数同一个数） */
const typeCount = computed(() => (sv.value?.facts ? sv.value.typeOnly : 0))
const hint = computed(() => (facts.value ? '' : FACTS_HINT[desk.facts.status.value]))
</script>

<template>
  <DisplayGroup title="结构边 · 种类与档" :open="open" @toggle="emit('toggle')">
    <template v-if="facts" #actions>
      <label class="switch" title="只引类型的依赖边缺省收起；打开后以浅色画出">
        <input v-model="typeOnly" type="checkbox" role="switch" aria-label="只引类型" />
      </label>
    </template>
    <template v-if="facts">
      <div v-for="k in STRUCTURE_KINDS" :key="k" class="item">
        <span class="sw kind"><StructureSwatch :kind="k" /></span>
        <span
          >{{ STRUCTURE_KIND_LABEL[k] }}<span class="hint"> = {{ STRUCTURE_KIND_HINT[k] }}</span></span
        >
      </div>
      <div class="section-label">依赖的档 · 浓淡</div>
      <div v-for="t in DEP_TIERS" :key="t" class="item" :class="{ muted: t === 'type' && !typeOnly }">
        <span class="sw kind"><StructureSwatch :tier="t" /></span>
        <span
          >{{ DEP_TIER_LABEL[t] }}<span class="hint"> = {{ DEP_TIER_HINT[t] }}</span></span
        >
      </div>
      <div class="item type-count" data-testid="type-only-count">
        <span class="sw kind"
          ><span class="chip">{{ typeCount }}</span></span
        >
        <span v-if="!typeOnly">只引类型 {{ typeCount }} 条已收起（打开右上角开关显示）</span>
        <span v-else>只引类型 {{ typeCount }} 条已显示</span>
      </div>
    </template>
    <template v-else>
      <div class="item muted">{{ hint }}</div>
      <div class="item">
        <span class="sw kind"><StructureSwatch kind="allowed" /></span>
        <span>点线 = 规则允许的依赖（mayDependOn）；没有代码事实，只画允许依赖</span>
      </div>
    </template>
  </DisplayGroup>
</template>

<style scoped>
.sw.kind {
  width: 36px;
}

.hint {
  color: var(--text-3);
}
</style>
