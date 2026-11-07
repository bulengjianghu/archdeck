<script setup lang="ts">
/**
 * 相关资料卡（PC-9，R3.5）：本模块的图解（有图解才列，判定由 HAS_EXPLAINER 注入，EX-1）与参与的场景；图解依据过期时标「基于旧描述 · N 处改动」（EX-7）。
 * 图解单击 = 选中模块并激活图解标签（LY-15）；场景单击 = 打开场景（时序图标签随场景情境常驻，LY-9）。第二十二轮随抽屉删除（PC-9 作废，波 2）。
 * 没有条目时整卡不出现（PC-1）；条目多于 3 份时缺省收起、卡头给「N 份」（ADR-0060：三卡尽量一屏），少于等于 3 份展开。
 */
import { computed, inject } from 'vue'
import { useDesk } from '@/state/inject'
import PanelCard from './PanelCard.vue'
import { HAS_EXPLAINER } from './related'
import { staleText } from '../shared/explainerText'

const props = defineProps<{ module?: string; scenarios?: readonly string[]; /** 场景面板：当前场景的时序图（PC-10） */ sequence?: boolean }>()
const desk = useDesk()
const hasExplainer = inject(HAS_EXPLAINER, () => false)
const name = (id: string) => desk.index.value?.modules.get(id)?.name ?? id
const explainer = computed(() => (props.module && hasExplainer(props.module) ? props.module : null))
const scenes = computed(() => (props.scenarios ?? []).map(id => desk.index.value?.scenarios.get(id)).filter(s => !!s))
const count = computed(() => (explainer.value ? 1 : 0) + scenes.value.length + (props.sequence ? 1 : 0))
const seqOpen = computed(() => !!desk.playback.value)
const explainerOpen = computed(() => {
  const s = desk.subject.value
  return !!explainer.value && s?.kind === 'module' && s.id === explainer.value
})
const sceneOpen = (id: string) => desk.run.scenario.value?.id === id && seqOpen.value
const explainerStale = computed(() => {
  const st = explainer.value ? desk.explainers.status(explainer.value) : null
  return st?.stale ? staleText(st) : null
})
const openExplainer = () => explainer.value && desk.readExplainer(explainer.value)
</script>

<template>
  <PanelCard v-if="count" kind="related" title="相关资料" :summary="`${count} 份`" :open="count <= 3">
    <ul class="res-list" data-testid="related">
      <li v-if="explainer" class="res" :class="{ opened: explainerOpen }" data-doc="explainer" @click="openExplainer()">
        <span class="ic">▣</span
        ><span class="nm"
          >{{ name(explainer) }} 的图解<span v-if="explainerStale" class="stale" data-testid="related-stale">{{ explainerStale }}</span></span
        ><span class="kd">{{ explainerOpen ? '已打开' : '图解' }}</span>
      </li>
      <li v-if="sequence" class="res" :class="{ opened: seqOpen }" data-doc="sequence" @click="desk.workspace.showView('sequence')">
        <span class="ic">▶</span><span class="nm">时序图</span><span class="kd">{{ seqOpen ? '已打开' : '时序图' }}</span>
      </li>
      <li v-for="s in scenes" :key="s.id" class="res" :class="{ opened: sceneOpen(s.id) }" data-doc="scenario" @click="desk.openScenario(s.id)">
        <span class="ic">▶</span
        ><span class="nm"
          >{{ s.name }}<span v-if="s.cause" class="cause">{{ s.cause }}</span></span
        ><span class="kd">{{ sceneOpen(s.id) ? '已打开' : '场景' }}</span>
      </li>
    </ul>
  </PanelCard>
</template>

<style scoped>
.res-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.res {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  cursor: pointer;
  user-select: none;
}

.res:hover .nm {
  color: var(--accent);
}

.ic {
  flex: none;
  width: 16px;
  text-align: center;
  color: var(--text-3);
}

.nm {
  min-width: 0;
}

.cause {
  display: block;
  font-size: 11.5px;
  color: var(--text-3);
}

.kd {
  margin-left: auto;
  flex: none;
  font-size: 11px;
  color: var(--text-3);
}

.opened .nm {
  color: var(--accent);
  font-weight: 600;
}

.hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--text-3);
}

.stale {
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--warning);
  background: var(--warning-soft);
  white-space: nowrap;
}
</style>
