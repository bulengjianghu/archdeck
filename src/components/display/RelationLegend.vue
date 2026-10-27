<script setup lang="ts">
/**
 * 「显示」面板 · 关系（颜色通道，ADR-0018 / ADR-0017 第三轮），按「三问四修饰」组织（ADR-0029 §3）：
 * - 三问：三个判断题定类型，每个答案落到一类；类型行既是图例又是筛选（结构视角点击筛选，L8），示意按画布同一套样式（查询淡、委托实色）。
 * - 迁移期的未分类（calls，M17）单列一行，中性灰。
 * - 「四修饰」是读完类型再读的修饰：机制（直接 / 端口——插座记号 L12 / 经回调——标签「回调」L24 / 总线 / 通道——面板标出）、异步（空心箭头）、拉取（面板标出），
 *   与粗细（聚合条数）一起放在浅底卡片里、中性色示意、不可点击。
 * 线型（实线 = 交互、虚线 = 依赖，ADR-0035）在「共享」组讲；代码事实写在标签位，在「代码事实 · 标签」组讲。
 */
import { computed } from 'vue'
import { RELATION_TYPES, isUnclassified, type RelationType } from '@/model'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import LineSwatch from './LineSwatch.vue'
import { TYPE_HINT, TYPE_LABEL, TYPE_ORDER } from './labels'
import { THREE_QUESTIONS, VIA_KIND_HINTS, VIA_KIND_LABELS } from '../shared/labels'

defineProps<{ run: boolean; open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()

const NEUTRAL = 'var(--text-2)'
const CLASSIFIED = TYPE_ORDER.filter(t => !isUnclassified(t))
const UNCLASSIFIED = TYPE_ORDER.filter(isUnclassified)
const lookOf = (t: RelationType, off = false) => ({ type: t, weight: 2 as const, muted: off })
/** 示意的箭头：通知一律异步（空心），其余按同步画实心 */
const arrowOf = (t: RelationType) => (t === 'notifies' ? 'open' : 'closed')
const shown = (t: RelationType) => desk.toggles.relationTypes.includes(t)
const hiddenTypes = computed(() => RELATION_TYPES.length - desk.toggles.relationTypes.length)
function toggleType(t: RelationType) {
  const list = desk.toggles.relationTypes
  desk.setToggles({ relationTypes: shown(t) ? list.filter(x => x !== t) : [...list, t] })
}
const showAllTypes = () => desk.setToggles({ relationTypes: [...RELATION_TYPES] })
</script>

<template>
  <DisplayGroup title="关系 · 三问四修饰" :open="open" @toggle="emit('toggle')">
    <template v-if="!run && open" #actions>
      <button v-if="hiddenTypes" class="link" @click="showAllTypes">全部显示</button>
      <span v-else class="aside-note">点击筛选</span>
    </template>
    <ol class="questions" aria-label="三问定类型">
      <li v-for="(x, i) in THREE_QUESTIONS" :key="i">
        <span class="q">{{ x.q }}</span>
        <span v-for="(a, k) in x.answers" :key="a.type" class="answer"
          >{{ k ? '；' : '' }}{{ a.a }} → <b :class="`rel-${a.type}`">{{ TYPE_LABEL[a.type] }}</b></span
        >
      </li>
    </ol>
    <div class="type-list" :role="run ? undefined : 'group'" :aria-label="run ? undefined : '关系类型筛选'">
      <template v-for="sec in [CLASSIFIED, UNCLASSIFIED]" :key="sec.join()">
        <div v-if="sec === UNCLASSIFIED" class="section">迁移期</div>
        <template v-if="!run">
          <button
            v-for="t in sec"
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
          <div v-for="t in sec" :key="t" class="item">
            <span class="sw"><LineSwatch :look="lookOf(t)" :arrow="arrowOf(t)" :width="36" /></span>
            <span
              >{{ TYPE_LABEL[t] }}<span class="hint"> = {{ TYPE_HINT[t] }}</span></span
            >
          </div>
        </template>
      </template>
    </div>

    <div class="reading" aria-label="四修饰">
      <div class="reading-title">四修饰 · 读完类型再读，适用于任意类型</div>
      <div class="reading-row">
        <span class="dim">机制</span>
        <span class="pair" :title="VIA_KIND_HINTS.direct"><LineSwatch :color="NEUTRAL" :width="22" arrow="closed" />{{ VIA_KIND_LABELS.direct }}</span>
        <span class="pair" :title="VIA_KIND_HINTS.port"><LineSwatch :color="NEUTRAL" :width="26" arrow="closed" socket />{{ VIA_KIND_LABELS.port }}</span>
        <span class="pair" title="经回调（L24）：发起方调用的是接收方交来的执行器，代码依赖方向与箭头相反"
          ><LineSwatch :color="NEUTRAL" :width="22" arrow="closed" /><span class="tag">回调</span>经回调</span
        >
        <span class="pair muted-text" :title="`${VIA_KIND_HINTS.bus}；${VIA_KIND_HINTS.channel}`"
          >{{ VIA_KIND_LABELS.bus }} · {{ VIA_KIND_LABELS.channel }}：见面板</span
        >
      </div>
      <div class="reading-row">
        <span class="dim">同步</span>
        <span class="pair"><LineSwatch :color="NEUTRAL" :width="18" arrow="closed" />同步</span>
        <span class="pair"><LineSwatch :color="NEUTRAL" :width="18" arrow="open" />异步</span>
        <span class="pair muted-text" title="拉取型流（pull），箭头仍指数据去向">拉取：见面板</span>
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
/* L24：标签位文字的示意（与画布 ×N 标签同样式） */
.tag {
  padding: 0 5px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  font-size: 11px;
  line-height: 15px;
  color: var(--text-2);
  background: var(--surface);
}

/* 带箭头的类型示意比通用示意列宽一些，线不被箭头吃掉 */
.type-list .sw {
  width: 36px;
}

.hint {
  color: var(--text-3);
}

.questions {
  margin: 0 0 4px;
  padding-left: 16px;
  font-size: 11.5px;
  color: var(--text-2);
}

.questions li {
  line-height: 1.6;
}

.questions .q {
  margin-right: 4px;
}

.questions b {
  font-weight: 600;
  color: var(--rel);
}

.muted-text {
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
