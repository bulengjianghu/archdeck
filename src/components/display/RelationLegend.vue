<script setup lang="ts">
/**
 * 「显示」面板 · 关系类型（颜色通道，ADR-0018 / ADR-0017 第三轮）：
 * - 类型列表是主体：按运行时 / 编译期两段，行既是图例又是筛选（结构视角点击筛选，L8）；示意带该类关系在画布上的箭头
 *   （箭头按同步 / 异步取，只有 implements 固定为空心三角，arrowOf），所以类型行一律画实心、implements 画三角。
 * - 「线的读法」是修饰：对任意类型都适用的箭头与粗细，放在浅底卡片里、中性色示意、不可点击。
 * 每行在类型名后给一句读法（ADR-0022、ADR-0026）：命令 = 要结果（可同步或异步）；通知 = 不要结果、一对多、箭头指向被通知方；流 = 连续数据、箭头指向数据去向。
 * 线型（事实状态）不在这里讲，只在「代码事实」组。
 */
import { computed } from 'vue'
import { RELATION_TYPES, RUNTIME_RELATION_TYPES, type RelationType } from '@/model'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import LineSwatch from './LineSwatch.vue'
import { TYPE_HINT, TYPE_LABEL, TYPE_ORDER } from './labels'

defineProps<{ run: boolean; open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()

const NEUTRAL = 'var(--text-2)'
const isRuntime = (t: RelationType) => RUNTIME_RELATION_TYPES.includes(t)
const SECTIONS = [
  { title: '运行时', types: TYPE_ORDER.filter(isRuntime) },
  { title: '编译期', types: TYPE_ORDER.filter(t => !isRuntime(t)) },
]
const lookOf = (t: RelationType, off = false) => ({ type: t, compile: !isRuntime(t), weight: 2 as const, muted: off })
const arrowOf = (t: RelationType) => (t === 'implements' ? 'triangle' : 'closed')
const shown = (t: RelationType) => desk.toggles.relationTypes.includes(t)
const hiddenTypes = computed(() => RELATION_TYPES.length - desk.toggles.relationTypes.length)
function toggleType(t: RelationType) {
  const list = desk.toggles.relationTypes
  desk.setToggles({ relationTypes: shown(t) ? list.filter(x => x !== t) : [...list, t] })
}
const showAllTypes = () => desk.setToggles({ relationTypes: [...RELATION_TYPES] })
</script>

<template>
  <DisplayGroup title="关系类型 · 颜色" :open="open" @toggle="emit('toggle')">
    <template v-if="!run && open" #actions>
      <button v-if="hiddenTypes" class="link" @click="showAllTypes">全部显示</button>
      <span v-else class="aside-note">点击筛选</span>
    </template>
    <div class="type-list" :role="run ? undefined : 'group'" :aria-label="run ? undefined : '关系类型筛选'">
      <template v-for="sec in SECTIONS" :key="sec.title">
        <div class="section">{{ sec.title }}</div>
        <template v-if="!run">
          <button
            v-for="t in sec.types"
            :key="t"
            class="item type"
            :class="{ off: !shown(t) }"
            :aria-pressed="shown(t)"
            :title="shown(t) ? '点击隐藏这类关系' : '点击显示这类关系'"
            @click="toggleType(t)"
          >
            <span class="sw"><LineSwatch :look="lookOf(t, !shown(t))" :arrow="arrowOf(t)" :width="36" /></span>
            <span
              >{{ TYPE_LABEL[t] }}<span class="hint"> = {{ TYPE_HINT[t] }}</span></span
            >
          </button>
        </template>
        <template v-else>
          <div v-for="t in sec.types" :key="t" class="item">
            <span class="sw"><LineSwatch :look="lookOf(t)" :arrow="arrowOf(t)" :width="36" /></span>
            <span
              >{{ TYPE_LABEL[t] }}<span class="hint"> = {{ TYPE_HINT[t] }}</span></span
            >
          </div>
        </template>
      </template>
    </div>

    <div class="reading" aria-label="线的读法">
      <div class="reading-title">线的读法 · 适用于任意类型</div>
      <div class="reading-row">
        <span class="dim">箭头</span>
        <span class="pair"><LineSwatch :color="NEUTRAL" :width="18" arrow="closed" />同步</span>
        <span class="pair"><LineSwatch :color="NEUTRAL" :width="18" arrow="open" />异步</span>
        <span class="pair"><LineSwatch :color="NEUTRAL" :width="18" arrow="triangle" />实现</span>
      </div>
      <div class="reading-row">
        <span class="dim">粗细</span>
        <span class="pair"><LineSwatch :color="NEUTRAL" :width="16" :look="{ weight: 1 }" />1 条</span>
        <span class="pair"><LineSwatch :color="NEUTRAL" :width="16" :look="{ weight: 2 }" />2–4</span>
        <span class="pair"><LineSwatch :color="NEUTRAL" :width="22" :look="{ weight: 3 }" pill />≥5 · ×N</span>
      </div>
    </div>
  </DisplayGroup>
</template>

<style scoped>
/* 带箭头的类型示意比通用示意列宽一些，线不被箭头吃掉 */
.type-list .sw {
  width: 36px;
}

.hint {
  color: var(--text-3);
}

.section {
  margin-top: 2px;
  font-size: 10.5px;
  color: var(--text-3);
}

.reading {
  margin-top: 6px;
  padding: 5px 8px 6px;
  background: var(--surface-2);
  border-radius: 6px;
  color: var(--text-2);
  font-size: 11.5px;
}

.reading-title {
  margin-bottom: 2px;
  font-size: 10.5px;
  color: var(--text-3);
}

.reading-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 20px;
  white-space: nowrap;
}

.reading-row .dim {
  width: 24px;
  flex: none;
  font-size: 11px;
  color: var(--text-3);
}

.pair {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
