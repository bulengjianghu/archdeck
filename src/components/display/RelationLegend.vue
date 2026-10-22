<script setup lang="ts">
/** 「显示」面板 · 关系：类型行既是图例又是筛选（结构视角点击筛选，L8）；线型、箭头、线宽各一行说明（L10） */
import { computed } from 'vue'
import { RELATION_TYPES, RUNTIME_RELATION_TYPES, type RelationType } from '@/model'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import LineSwatch from './LineSwatch.vue'
import { TYPE_LABEL, TYPE_ORDER } from './labels'

defineProps<{ run: boolean; open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()

const NEUTRAL = 'var(--text-2)'
const lookOf = (t: RelationType, off = false) => ({ type: t, compile: !RUNTIME_RELATION_TYPES.includes(t), weight: 2 as const, muted: off })
const shown = (t: RelationType) => desk.toggles.relationTypes.includes(t)
const hiddenTypes = computed(() => RELATION_TYPES.length - desk.toggles.relationTypes.length)
function toggleType(t: RelationType) {
  const list = desk.toggles.relationTypes
  desk.setToggles({ relationTypes: shown(t) ? list.filter(x => x !== t) : [...list, t] })
}
const showAllTypes = () => desk.setToggles({ relationTypes: [...RELATION_TYPES] })
</script>

<template>
  <DisplayGroup title="关系" :open="open" @toggle="emit('toggle')">
    <template v-if="!run && open" #actions>
      <button v-if="hiddenTypes" class="link" @click="showAllTypes">全部显示</button>
      <span v-else class="aside-note">点击筛选</span>
    </template>
    <div v-if="!run" role="group" aria-label="关系类型筛选">
      <button
        v-for="t in TYPE_ORDER"
        :key="t"
        class="item type"
        :class="{ off: !shown(t) }"
        :aria-pressed="shown(t)"
        :title="shown(t) ? '点击隐藏这类关系' : '点击显示这类关系'"
        @click="toggleType(t)"
      >
        <span class="sw"><LineSwatch :look="lookOf(t, !shown(t))" /></span>
        <span>{{ TYPE_LABEL[t] }}</span>
      </button>
    </div>
    <template v-else>
      <div v-for="t in TYPE_ORDER" :key="t" class="item">
        <span class="sw"><LineSwatch :look="lookOf(t)" /></span>
        <span>{{ TYPE_LABEL[t] }}</span>
      </div>
    </template>
    <div class="item">
      <span class="sw pair"><LineSwatch :color="NEUTRAL" :width="13" /><LineSwatch :color="NEUTRAL" :width="13" :look="{ factState: 'unconfirmed' }" /></span>
      <span>实线 = 已证实，虚线 = 未证实</span>
    </div>
    <div class="item">
      <span class="sw pair wide"><LineSwatch :color="NEUTRAL" :width="24" arrow="closed" /><LineSwatch :color="NEUTRAL" :width="24" arrow="open" /></span>
      <span>箭头实心 = 同步，空心 = 异步</span>
    </div>
    <div class="item">
      <span class="sw"><LineSwatch :look="{ type: 'implements', compile: true }" arrow="triangle" /></span>
      <span>空心三角 = 实现端口 / 契约</span>
    </div>
    <div class="item">
      <span class="sw"><LineSwatch :color="NEUTRAL" :look="{ weight: 3 }" pill /></span>
      <span>线越粗 = 聚合的关系越多（×N）</span>
    </div>
  </DisplayGroup>
</template>

<style scoped>
.sw.pair {
  gap: 2px;
}

/* 箭头与画布同大（14 px 起），两段并排放不进 28 px 的示意列 */
.sw.wide {
  width: auto;
}

.aside-note {
  font-size: 11px;
  color: var(--text-3);
}

.link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 11px;
  color: var(--accent);
}

.type {
  border: none;
  background: none;
  font: inherit;
  padding: 0 4px;
  margin: 0 -4px;
  width: calc(100% + 8px);
  border-radius: 4px;
}

.type:hover {
  background: var(--surface-2);
}

.type.off > span:last-child {
  color: var(--text-3);
}
</style>
