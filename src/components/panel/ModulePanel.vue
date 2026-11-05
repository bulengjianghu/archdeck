<script setup lang="ts">
/**
 * 模块的选中抽屉（第二十轮读先方案重定义）：抽屉是「操作与核对」的地方——身份卡（名称、徽标、动作）、设计说明、
 * 核对卡（ModuleCheck）。理解叙述归辅助栏的理解页（事实卡 + 故事，ModuleDoc）；相关资料卡删除（场景归运行视角的
 * 场景列表，图解入口在理解页与画布 ▣）；换选中时面板整体重建。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { stratumKey } from '@/model'
import ChangeBadge from './ChangeBadge.vue'
import DesignNote from './DesignNote.vue'
import ModuleCheck from './ModuleCheck.vue'
import { usePanelJump } from './panelNotices'
import { canDesignAt, openNewDesign } from '../edit/designHere'

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
    <header class="head id-card" data-sec="head">
      <h2>{{ m.name }}</h2>
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
