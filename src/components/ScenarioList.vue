<script setup lang="ts">
/**
 * 场景列表（D-1、R4、R4a、R17）：默认只列与当前层次相关的场景（有帧端点在当前子树内），可切到全部、按发起者筛选；
 * R17：默认只列主流程（kind: main），可切到「全部类别」（记在本机，不进 URL），非主流程项标出类别。
 * 筛选是侧栏与画布「场景 ▾」共用的一份（sideFilters）：侧栏页里收在「筛选 ▾」弹层（LY-4d），下拉里平铺在列表上方；
 * 选定即进入回放（交互视角 + 这个场景，LY-6），不改变层次。住在侧栏「场景」页（LY-4，inline）。声明了证据文件的场景标「测试 N」（N 为证据文件数，S15、D-20）——只说明声明了测试，不说明测过了；无证据步骤标「? N」（S17）。
 */
import { computed, provide } from 'vue'
import { useDesk } from '@/state/inject'
import { scenarioKind, type ScenarioKind } from '@/model'
import { scenarioListing } from './tree/scenarioListing'
import { SIDE_FILTERS, useSideFilters } from './shared/sideFilters'
import ScenarioFilters from './tree/ScenarioFilters.vue'

defineProps<{ /** 侧栏页里平铺（不是弹出层） */ inline?: boolean }>()
const emit = defineEmits<{ picked: [] }>()
const desk = useDesk()
const filters = useSideFilters()
// 下拉里平铺的筛选（ScenarioFilters）读同一份——没有项目视图提供时也一样
provide(SIDE_FILTERS, filters)
const { scope, kinds, trigger } = filters
const KIND_LABEL: Record<ScenarioKind, string> = { main: '主流程', exception: '异常', maintenance: '维护' }

const listing = computed(() => scenarioListing(desk, { scope: scope.value, kinds: kinds.value, trigger: trigger.value }))
const all = computed(() => listing.value.all)
const inScope = computed(() => listing.value.inScope)
const shown = computed(() => listing.value.shown)

function pick(id: string) {
  desk.openScenario(id)
  emit('picked')
}
</script>

<template>
  <div class="scenario-list" :class="{ inline }" :role="inline ? 'region' : 'dialog'" aria-label="选择场景">
    <ScenarioFilters v-if="!inline" class="filters" />
    <ul v-if="shown.length">
      <li v-for="x in shown" :key="x.s.id">
        <button class="item" :class="{ current: desk.playback.value?.scenarioId === x.s.id }" @click="pick(x.s.id)">
          <span class="name"
            >▶ {{ x.s.name }}<span v-if="scenarioKind(x.s) !== 'main'" class="kind-tag" :data-kind="scenarioKind(x.s)">{{ KIND_LABEL[scenarioKind(x.s)] }}</span
            ><span v-if="x.s.evidence?.length" class="evidence" :title="`声明了 ${x.s.evidence.length} 个证据文件（测试 / E2E），不代表已通过`">
              测试 {{ x.s.evidence.length }}</span
            ><span
              v-if="desk.evidence.unevidenced.value.get(x.s.id)"
              class="unevidenced"
              :title="`${desk.evidence.unevidenced.value.get(x.s.id)} 个步骤在代码里没有证据（S17）`"
            >
              ? {{ desk.evidence.unevidenced.value.get(x.s.id) }}</span
            ></span
          >
          <span class="meta">{{ x.byName }} 发起 · {{ x.count }} 条消息</span>
          <span v-if="x.s.cause" class="cause">{{ x.s.cause }}</span>
        </button>
      </li>
    </ul>
    <p v-else class="none muted">
      {{
        !all.length ? '这个项目还没有场景描述' : inScope.length ? '没有主流程场景，可切到「全部类别」' : '与当前层次相关的场景没有符合条件的，可切到「全部」'
      }}
    </p>
  </div>
</template>

<style scoped>
.scenario-list {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 30;
  width: 380px;
  max-height: 60vh;
  overflow: auto;
  padding: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgb(0 0 0 / 14%);
}

.scenario-list.inline {
  position: static;
  width: auto;
  max-height: none;
  overflow: visible;
  padding: 0 6px;
  background: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.filters {
  margin-bottom: 6px;
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  border: none;
  border-radius: 6px;
  padding: 6px 8px;
  text-align: left;
  background: none;
}

.item:hover,
.item.current {
  background: var(--accent-soft);
}

.name {
  font-weight: 600;
}

.kind-tag {
  margin-left: 6px;
  padding: 0 5px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-2);
  border: 1px solid var(--border-strong);
  border-radius: 3px;
}

.kind-tag[data-kind='exception'] {
  color: var(--danger);
  border-color: var(--danger);
}

.unevidenced {
  color: var(--warning);
  font-weight: 400;
}

.evidence {
  color: var(--success, var(--accent));
  font-weight: 400;
}

.meta,
.cause {
  font-size: 12px;
  color: var(--text-3);
}

.none {
  margin: 8px;
  font-size: 12.5px;
}
</style>
