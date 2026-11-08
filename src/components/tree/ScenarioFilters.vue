<script setup lang="ts">
/**
 * 场景的筛选（R4、R4a、R17；LY-4d）：范围（本层相关 / 全部）、类别（主流程 / 全部类别）、发起者。
 * 平铺在画布「场景 ▾」下拉的列表上方；在侧栏「筛选 ▾」弹层里按组竖排、带组名（stacked）。读写同一份 sideFilters。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { useSideFilters } from '../shared/sideFilters'
import { scenarioListing } from './scenarioListing'

defineProps<{ stacked?: boolean }>()
const desk = useDesk()
const { scope, kinds, trigger } = useSideFilters()
const listing = computed(() => scenarioListing(desk, { scope: scope.value, kinds: kinds.value, trigger: trigger.value }))
</script>

<template>
  <div class="scenario-filters" :class="{ stacked }">
    <div class="grp">
      <div v-if="stacked" class="fl">范围</div>
      <div class="seg" role="group" aria-label="范围">
        <button :class="{ on: scope === 'level' }" :aria-pressed="scope === 'level'" @click="scope = 'level'">本层相关 {{ listing.related.size }}</button>
        <button :class="{ on: scope === 'all' }" :aria-pressed="scope === 'all'" @click="scope = 'all'">全部 {{ listing.all.length }}</button>
      </div>
    </div>
    <div class="grp">
      <div v-if="stacked" class="fl">类别</div>
      <div class="seg" role="group" aria-label="类别">
        <button :class="{ on: kinds === 'main' }" :aria-pressed="kinds === 'main'" title="只列主流程（kind: main）" @click="kinds = 'main'">
          主流程 {{ listing.mainCount }}
        </button>
        <button :class="{ on: kinds === 'all' }" :aria-pressed="kinds === 'all'" title="含异常处理与维护类流程" @click="kinds = 'all'">
          全部类别 {{ listing.inScope.length }}
        </button>
      </div>
    </div>
    <div class="grp">
      <div v-if="stacked" class="fl">发起者</div>
      <select v-model="trigger" aria-label="按发起者筛选">
        <option value="">全部发起者</option>
        <option v-for="[id, name] in listing.triggers" :key="id" :value="id">{{ name }}</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.scenario-filters {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
}

.scenario-filters.stacked {
  display: grid;
  gap: 10px;
}

.fl {
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--text-3);
}

.seg {
  display: flex;
}

.stacked .seg button {
  flex: 1;
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

.stacked select {
  width: 100%;
}
</style>
