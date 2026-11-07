<script setup lang="ts">
/**
 * 模块的面板（第二十二轮 LY-13）：「描述」里是一行操作（动作与徽标，名称在主语条）、理解卡（五问 + 参与的场景）、设计说明；
 * 「核对」里是核对卡（ModuleCheck）。换选中时面板整体重建。
 */
import { computed, ref } from 'vue'
import { usePanelPart } from '../shared/panelPart'
import { useDesk } from '@/state/inject'
import { stratumKey } from '@/model'
import ChangeBadge from './ChangeBadge.vue'
import DesignNote from './DesignNote.vue'
import ModuleCheck from './ModuleCheck.vue'
import ModuleUnderstand from './ModuleUnderstand.vue'
import PanelCard from './PanelCard.vue'
import ScopeSummary from './ScopeSummary.vue'
import NameActions from './NameActions.vue'
import { usePanelJump } from './panelNotices'
import { canDesignAt, openNewDesign } from '../edit/designHere'

const props = defineProps<{ id: string }>()
const desk = useDesk()
/** LY-13、LY-7：描述里面板头是一行操作（不写名称与 ID），核对里不出现 */
const pp = usePanelPart()
const idx = computed(() => desk.index.value!)
const m = computed(() => idx.value.modules.get(props.id)!)
/** 参与的场景（理解卡尾一行；前三个直列，其余收 +N；单击进入回放） */
const scenarios = computed(() => idx.value.scenariosOf.get(props.id) ?? [])
const children = computed(() => idx.value.childrenOf.get(props.id) ?? [])
// ADR-0052：单成员层的成员就是层（根的四层）
const stratum = computed(() => idx.value.stratumOf.get(props.id) ?? null)
const isLayer = computed(() => stratum.value?.members.length === 1)
const pickStratum = () => stratum.value && desk.select({ kind: 'stratum', id: stratumKey(idx.value, stratum.value) })
const isCurrentLevel = computed(() => desk.levelId.value === props.id)
const STATUS: Record<string, string> = { current: '现状', target: '目标态', deprecated: '已废弃' }

// ── 头部徽标槽位表（V15a）：ID → 类别 → 状态 → 核心 → 标签 → 变更；标签静息态至多 2 个，其余收「+N」 ──
const TAG_CAP = 2
const tagsOpen = ref(false)
const tags = computed(() => m.value.tags ?? [])
const tagsShown = computed(() => (tagsOpen.value ? tags.value : tags.value.slice(0, TAG_CAP)))
const tagsHidden = computed(() => tags.value.length - tagsShown.value.length)

// 核对卡的异常条目单击跳到清单（展开并滚动到位，V15b）
const root = ref<HTMLElement | null>(null)
usePanelJump(root)
</script>

<template>
  <div v-if="m" ref="root" class="module-panel">
    <header v-if="pp.card" class="head id-card" data-sec="head">
      <h2 v-if="pp.name">{{ m.name }}<NameActions :module="m.id" place="id-card" /></h2>
      <div class="badges">
        <code v-if="pp.name">{{ m.id }}</code>
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
      <div v-if="!pp.name || (children.length && !isCurrentLevel) || canDesignAt(desk, m.id)" class="acts">
        <!-- LY-13b：描述里名称只在主语条，「讨论 ›」「图解 ›」挪进这一行操作 -->
        <NameActions v-if="!pp.name" :module="m.id" place="id-card" />
        <button v-if="children.length && !isCurrentLevel" class="drill" @click="desk.drillInto(m.id)">进入 ⌄</button>
        <button v-if="canDesignAt(desk, m.id)" class="drill" title="以这个模块为挂载点新建设计（F-10）" @click="openNewDesign(m.id)">在此设计</button>
      </div>
    </header>
    <!-- LY-13：描述的第一张卡是理解（五问：是什么、原则、不变式、接口与数据、协作与边界），事实全部从描述渲染；参与的场景附在卡尾 -->
    <PanelCard v-if="pp.part === 'description'" kind="understand" title="理解" closed-summary :summary="m.summary || undefined">
      <ModuleUnderstand :id="m.id" />
      <p class="scenarios" data-testid="fact-scenarios">
        <template v-if="scenarios.length"
          >出现在 {{ scenarios.length }} 个场景：<button v-for="sid in scenarios.slice(0, 3)" :key="sid" class="link" @click="desk.openScenario(sid)">
            {{ idx.scenarios.get(sid)?.name ?? sid }}</button
          ><span v-if="scenarios.length > 3" class="muted">+{{ scenarios.length - 3 }}</span></template
        ><span v-else class="muted">不在任何场景里</span>
      </p>
    </PanelCard>
    <DesignNote :text="m.designNote" />

    <!-- LY-13：层（单成员的层即这个模块）先给这棵子树的汇总 -->
    <ScopeSummary v-if="isLayer" :roots="[m.id]" />
    <ModuleCheck :id="m.id" />

    <footer class="src muted">出处：{{ desk.modelDir.value }}/{{ m.src.file }}{{ m.src.line ? `:${m.src.line}` : '' }}</footer>
  </div>
</template>

<style scoped>
.badge-more {
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
</style>
