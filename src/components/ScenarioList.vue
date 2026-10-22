<script setup lang="ts">
/**
 * 场景列表（D-1、R4、R4a）：默认只列与当前层次相关的场景（有帧端点在当前子树内），可切到全部、按发起者筛选；
 * 选定即进入运行视角，不改变层次。声明了证据文件的场景标「测试 N」（N 为证据文件数，S15、D-20）——只说明声明了测试，不说明测过了；无证据步骤标「? N」（S17）。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'

const emit = defineEmits<{ picked: [] }>()
const desk = useDesk()
const scope = ref<'level' | 'all'>('level')
const trigger = ref('')

const all = computed(() =>
  desk.run.catalog.value.map(({ scenario: s, trigger: by, messages }) => ({ s, by, byName: by ? moduleName(desk.index.value!, by) : '—', count: messages })),
)
const related = computed(() => new Set(desk.index.value?.scenariosOf.get(desk.levelId.value) ?? []))
const triggers = computed(() => [...new Map(all.value.filter(x => x.by).map(x => [x.by!, x.byName])).entries()])
const shown = computed(() => all.value.filter(x => (scope.value === 'all' || related.value.has(x.s.id)) && (!trigger.value || x.by === trigger.value)))

function pick(id: string) {
  desk.openScenario(id)
  emit('picked')
}
</script>

<template>
  <div class="scenario-list" role="dialog" aria-label="选择场景">
    <div class="filters">
      <div class="seg" role="group" aria-label="范围">
        <button :class="{ on: scope === 'level' }" @click="scope = 'level'">本层相关 {{ related.size }}</button>
        <button :class="{ on: scope === 'all' }" @click="scope = 'all'">全部 {{ all.length }}</button>
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
            >▶ {{ x.s.name
            }}<span v-if="x.s.evidence?.length" class="evidence" :title="`声明了 ${x.s.evidence.length} 个证据文件（测试 / E2E），不代表已通过`">
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
      {{ all.length ? '与当前层次相关的场景没有符合条件的，可切到「全部」' : '这个项目还没有场景描述' }}
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

.filters {
  display: flex;
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
