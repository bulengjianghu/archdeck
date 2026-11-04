<script setup lang="ts">
/**
 * 模块面板（V15、PC-1–PC-9，ADR-0053）：头部（名称、进入 / 在此设计、徽标槽位表 V15a、设计说明）之下三张卡片——
 * 理解（五问，ModuleUnderstand）、核对（六行 + 折叠清单，ModuleCheck）、相关资料（图解与参与的场景，RelatedCard）。
 * 头部粘在属性栏顶部；换选中时面板整体重建，卡片与折叠块的展开都不跨选中保持。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { stratumKey, summaryOf } from '@/model'
import ChangeBadge from './ChangeBadge.vue'
import DesignNote from './DesignNote.vue'
import PanelCard from './PanelCard.vue'
import ModuleUnderstand from './ModuleUnderstand.vue'
import ModuleCheck from './ModuleCheck.vue'
import RelatedCard from './RelatedCard.vue'
import { usePanelJump } from './panelNotices'
import { canDesignAt, openNewDesign } from '../edit/designHere'
import { staleText } from '../shared/explainerText'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const idx = computed(() => desk.index.value!)
const m = computed(() => idx.value.modules.get(props.id)!)
const children = computed(() => idx.value.childrenOf.get(props.id) ?? [])
// ADR-0052：单成员层的成员就是层（根的四层）
const stratum = computed(() => idx.value.stratumOf.get(props.id) ?? null)
const isLayer = computed(() => stratum.value?.members.length === 1)
const pickStratum = () => stratum.value && desk.select({ kind: 'stratum', id: stratumKey(idx.value, stratum.value) })
const isCurrentLevel = computed(() => desk.levelId.value === props.id)
const STATUS: Record<string, string> = { current: '现状', target: '目标态', deprecated: '已废弃' }
const summary = computed(() => summaryOf(m.value)?.text ?? '')

// ── 头部徽标槽位表（V15a）：ID → 类别 → 状态 → 核心 → 标签 → 变更；标签静息态至多 2 个，其余收「+N」 ──
const TAG_CAP = 2
const tagsOpen = ref(false)
const tags = computed(() => m.value.tags ?? [])
const tagsShown = computed(() => (tagsOpen.value ? tags.value : tags.value.slice(0, TAG_CAP)))
const tagsHidden = computed(() => tags.value.length - tagsShown.value.length)

// 核对卡的异常条目单击跳到清单（展开并滚动到位，V15b）
const root = ref<HTMLElement | null>(null)
usePanelJump(root)

// CD-3（第十八轮走查 4，ADR-0061）：有图解的模块，名称后附「图解 ›」，单击在资料区以预览打开（WS-5）；依据过期时提示进悬停（EX-7）。
// 结构视角下选中即自动打开（WS-8 的例外，由 DeskState 翻译），这里只管手动入口
const hasExplainer = computed(() => desk.explainers.has(m.value.id))
const explainerStale = computed(() => (hasExplainer.value ? desk.explainers.status(m.value.id) : null))
const explainerTip = computed(() => `打开原理图解（资料区预览）${explainerStale.value?.stale ? ` · ${staleText(explainerStale.value)}` : ''}`)
</script>

<template>
  <div v-if="m" ref="root" class="module-panel">
    <header class="head id-card" data-sec="head">
      <div class="titlerow">
        <h2>{{ m.name }}</h2>
        <button
          v-if="hasExplainer"
          class="badge link"
          data-testid="open-explainer"
          :title="explainerTip"
          @click="desk.workspace.open({ kind: 'explainer', module: m.id })"
        >
          图解 ›
        </button>
      </div>
      <div class="badges">
        <code>{{ m.id }}</code>
        <span v-if="isLayer" class="badge">层</span>
        <span v-else-if="m.kind" class="badge">{{ m.kind }}</span>
        <button v-if="stratum && !isLayer" class="badge link" data-testid="module-stratum" @click="pickStratum">层 · {{ stratum.name }}</button>
        <span v-if="m.status && m.status !== 'current'" class="badge warn">{{ STATUS[m.status] }}</span>
        <span v-if="m.role === 'core'" class="badge accent">核心</span>
        <span v-for="t in tagsShown" :key="t" class="badge">{{ t }}</span>
        <button
          v-if="tagsHidden > 0 || tagsOpen"
          class="badge badge-more"
          :title="tagsOpen ? undefined : tags.slice(TAG_CAP).join('、')"
          :aria-expanded="tagsOpen"
          @click="tagsOpen = !tagsOpen"
        >
          {{ tagsOpen ? '收起' : `+${tagsHidden}` }}
        </button>
        <ChangeBadge entity="module" :id="m.id" detail />
      </div>
      <!-- CD-3：动作是小号描边按钮，在徽标之下另起一行 -->
      <div v-if="(children.length && !isCurrentLevel) || canDesignAt(desk, m.id)" class="acts">
        <button v-if="children.length && !isCurrentLevel" class="drill" @click="desk.drillInto(m.id)">进入 ⌄</button>
        <button v-if="canDesignAt(desk, m.id)" class="drill" title="以这个模块为挂载点新建设计（F-10）" @click="openNewDesign(m.id)">在此设计</button>
      </div>
    </header>
    <DesignNote :text="m.designNote" />

    <PanelCard kind="understand" title="理解" closed-summary :summary="summary">
      <ModuleUnderstand :id="m.id" />
    </PanelCard>
    <ModuleCheck :id="m.id" />
    <RelatedCard :module="m.id" :scenarios="idx.scenariosOf.get(m.id) ?? []" />

    <footer class="src muted">出处：{{ desk.modelDir.value }}/{{ m.src.file }}{{ m.src.line ? `:${m.src.line}` : '' }}</footer>
  </div>
</template>

<style scoped>
.titlerow {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.titlerow .badge.link {
  flex: none;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.badge-more {
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
</style>
