<script setup lang="ts">
/**
 * 模块的理解页（第二十轮读先方案）：辅助栏的一页 = 事实卡 + 故事。
 * 事实卡是原理解卡搬了家（第二十轮 §3）：身份行 + ModuleUnderstand 六问 + 参与的场景 + 健康摘要——全部由架构台从描述渲染，
 * 永远是当下的真实值，不是 AI 写的；故事（图解）在事实卡之下，落后于描述时自带「基于旧描述」提示（EX-7）。
 * 无故事的模块只有事实卡（不显示催办，覆盖数只在系统面板看）。选中即自动打开（WS-8 例外）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import ModuleUnderstand from '../panel/ModuleUnderstand.vue'
import ExplainerDoc from './ExplainerDoc.vue'

const props = defineProps<{ module: string; withStory?: boolean }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)
const m = computed(() => idx.value.modules.get(props.module)!)

/** 参与的场景（事实卡的「出现在 N 个场景」行；前三个直列，其余收 +N；单击进运行视角） */
const scenarios = computed(() => idx.value.scenariosOf.get(props.module) ?? [])
const shown = computed(() => scenarios.value.slice(0, 3))

/** 健康摘要（一行；点开抽屉看核对卡）——违规与环来自代码事实，确认状态来自确认层，口径与核对卡一致 */
const detail = computed(() => (desk.facts.status.value === 'ready' ? desk.facts.moduleDetail(props.module) : null))
const violations = computed(() => (detail.value ? detail.value.violations.out.length + detail.value.violations.in.length : null))
const cycles = computed(() => (detail.value ? detail.value.cycles.length : null))
const review = computed(() => desk.review.of(props.module))
const REVIEW_TEXT: Record<string, string> = { reviewed: '已确认', stale: '需复核', unreviewed: '未确认' }
</script>

<template>
  <div v-if="m" class="module-doc" :data-module="module">
    <div class="fact" :class="{ paged: withStory }">
      <div class="fact-head">
        <h2>{{ m.name }}</h2>
        <code>{{ m.id }}</code>
        <span v-if="m.kind" class="badge">{{ m.kind }}</span>
        <span v-if="m.role === 'core'" class="badge accent">核心</span>
      </div>
      <ModuleUnderstand :id="module" />
      <p class="scenarios" data-testid="fact-scenarios">
        <template v-if="scenarios.length"
          >出现在 {{ scenarios.length }} 个场景：<button v-for="s in shown" :key="s" class="link" @click="desk.openScenario(s)">
            {{ idx.scenarios.get(s)?.name ?? s }}</button
          ><span v-if="scenarios.length > shown.length" class="more">+{{ scenarios.length - shown.length }}</span></template
        ><span v-else class="muted">不在任何场景里</span>
      </p>
      <p class="health" data-testid="fact-health">
        <template v-if="violations !== null"
          >健康：违规 {{ violations }} · 模块环 {{ cycles }} · <span :class="['review', review.status]">{{ REVIEW_TEXT[review.status] ?? review.status }}</span
          >（核对卡在选中抽屉）</template
        ><span v-else class="muted">健康：代码事实读取中…</span>
      </p>
    </div>
    <ExplainerDoc v-if="withStory" class="story" :module="module" />
  </div>
</template>

<style scoped>
.module-doc {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  font-size: 13.5px;
}

/* 第二十轮 02-review 缺陷 1：事实卡限高内部滚动，故事（iframe）撑满剩余高度、在 iframe 内滚到底 */
.fact {
  flex: 1 1 auto;
  min-height: 0;
}

.fact.paged {
  flex: 0 1 auto;
  max-height: 55%;
  overflow: auto;
  scrollbar-width: thin;
}

.story {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 12px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}

.fact-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}

.fact-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.fact-head code {
  font-size: 11.5px;
  color: var(--text-3);
}

.badge {
  font-size: 11px;
  padding: 0 7px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--text-2);
  border: 1px solid var(--border);
}

.badge.accent {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: transparent;
}

.scenarios,
.health {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: var(--text-2);
}

.scenarios .more,
.muted {
  color: var(--text-3);
}

.review.stale {
  color: var(--warning);
  font-weight: 600;
}

.review.reviewed {
  color: var(--ok, var(--text-2));
}
</style>
