<script setup lang="ts">
/**
 * 场景列表（D-1、R4、R4a、R17）：默认只列与当前层次相关的场景（有帧端点在当前子树内），可切到全部、按发起者筛选；
 * R17：默认只列主流程（kind: main），可切到「全部类别」（记在本机，不进 URL），非主流程项标出类别；
 * 选定即进入回放（交互视角 + 这个场景，LY-6），不改变层次。住在侧栏「场景」页（LY-4，inline）。声明了证据文件的场景标「测试 N」（N 为证据文件数，S15、D-20）——只说明声明了测试，不说明测过了；无证据步骤标「? N」（S17）。
 */
import { computed, ref, watch } from 'vue'
import { useDesk } from '@/state/inject'
import { filterScenariosByKind, moduleName, scenarioKind, type ScenarioKind } from '@/model'

defineProps<{ /** 侧栏页里平铺（不是弹出层） */ inline?: boolean }>()
const emit = defineEmits<{ picked: [] }>()
const desk = useDesk()
const scope = ref<'level' | 'all'>('level')
const trigger = ref('')

/** R17：类别筛选记在本机（所有项目共用），不进 URL */
const KINDS_KEY = 'h5p-arch-desk:scenario-kinds'
const readKinds = (): 'main' | 'all' => {
  try {
    return localStorage.getItem(KINDS_KEY) === 'all' ? 'all' : 'main'
  } catch {
    return 'main'
  }
}
const kinds = ref<'main' | 'all'>(readKinds())
watch(kinds, v => {
  try {
    localStorage.setItem(KINDS_KEY, v)
  } catch {
    /* 存不了就算了 */
  }
})
const KIND_LABEL: Record<ScenarioKind, string> = { main: '主流程', exception: '异常', maintenance: '维护' }

const all = computed(() =>
  desk.run.catalog.value.map(({ scenario: s, trigger: by, messages }) => ({ s, by, byName: by ? moduleName(desk.index.value!, by) : '—', count: messages })),
)
const related = computed(() => new Set(desk.index.value?.scenariosOf.get(desk.levelId.value) ?? []))
const triggers = computed(() => [...new Map(all.value.filter(x => x.by).map(x => [x.by!, x.byName])).entries()])
const inScope = computed(() => all.value.filter(x => (scope.value === 'all' || related.value.has(x.s.id)) && (!trigger.value || x.by === trigger.value)))
const mainCount = computed(
  () =>
    filterScenariosByKind(
      inScope.value.map(x => x.s),
      'main',
    ).length,
)
const shown = computed(() => {
  const keep = new Set(
    filterScenariosByKind(
      inScope.value.map(x => x.s),
      kinds.value,
    ),
  )
  return inScope.value.filter(x => keep.has(x.s))
})

function pick(id: string) {
  desk.openScenario(id)
  emit('picked')
}
</script>

<template>
  <div class="scenario-list" :class="{ inline }" :role="inline ? 'region' : 'dialog'" aria-label="选择场景">
    <div class="filters">
      <div class="seg" role="group" aria-label="范围">
        <button :class="{ on: scope === 'level' }" @click="scope = 'level'">本层相关 {{ related.size }}</button>
        <button :class="{ on: scope === 'all' }" @click="scope = 'all'">全部 {{ all.length }}</button>
      </div>
      <div class="seg" role="group" aria-label="类别">
        <button :class="{ on: kinds === 'main' }" title="只列主流程（kind: main）" @click="kinds = 'main'">主流程 {{ mainCount }}</button>
        <button :class="{ on: kinds === 'all' }" title="含异常处理与维护类流程" @click="kinds = 'all'">全部类别 {{ inScope.length }}</button>
      </div>
      <select v-model="trigger" aria-label="按发起者筛选">
        <option value="">全部发起者</option>
        <option v-for="[id, name] in triggers" :key="id" :value="id">{{ name }}</option>
      </select>
    </div>
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
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.seg {
  display: flex;
}

.seg button {
  font-size: 12px;
  border-radius: 0;
}

.seg button:first-child {
  border-radius: 6px 0 0 6px;
}

.seg button:last-child {
  border-radius: 0 6px 6px 0;
  margin-left: -1px;
}

.seg button.on {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
  position: relative;
}

select {
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
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
