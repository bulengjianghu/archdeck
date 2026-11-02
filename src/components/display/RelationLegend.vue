<script setup lang="ts">
/**
 * 图例 · 线（交互与运行视角；颜色通道 ADR-0018，图例行即开关 ADR-0056，按视觉通道组织 ADR-0058）：
 * - 类型行即开关（L45、L8）：示意 + 名称 + 勾选态，单击切换这一类的显示，关着的行淡色、常列（L47）；隐藏的类在画布角留痕计数。
 *   运行视角的类型行只读（回放不受筛选影响，L9）。示意按画布同一套样式（查询淡、委托实色）；迁移期的未分类（calls，M17）单列。
 *   类型的定义不写在行上（L51 修订：讲解进帮助与悬停）——行悬停给「名称 = 定义」，节标题旁的「?」打开帮助并定位到「读一条线」。
 * - 线的属性各一行、只解码（ADR-0058 准入三问）：粗细（共享通道 L18，WidthRow）、箭头（实心同步 / 空心异步，L10；经端口的插座 L12）、
 *   线型（实线交互 / 虚线依赖，ADR-0035；画面有虚线才列）。机制词、「混合」、两段标签位是写在线上的字（L26、L35），不列——
 *   画布 pill 自己会说话，悬停有释义（L50）；「直接」是没有记号的缺省态，不列。
 * - 只在边界边（L4）或核心跨层边（O4）上出现的类型是聚焦才画的临时记号，归脚注（TempLegend），这里不列。
 * - 图例按上下文显示（L47，G14）：类型行与属性行只列当前层次静息态画面出现的，行序按固定词表、行只显隐不重排。
 */
import { computed, inject } from 'vue'
import { isUnclassified, RELATION_TYPES, type RelationType } from '@/model'
import { useDesk } from '@/state/inject'
import { SHARED_TEXT, TYPE_HINT, TYPE_LABEL, TYPE_ORDER } from './labels'
import LegendToggle from './LegendToggle.vue'
import LineSwatch from './LineSwatch.vue'
import WidthRow from './WidthRow.vue'
import { VIA_KIND_HINTS, VIA_KIND_LABELS } from '../shared/labels'
import { OPEN_GUIDE } from '../shared/guide'

const props = defineProps<{ run: boolean; presence: Set<string> }>()
const desk = useDesk()
const openGuide = inject(OPEN_GUIDE, null)

const NEUTRAL = 'var(--text-2)'
const CLASSIFIED = TYPE_ORDER.filter((t: RelationType) => !isUnclassified(t))
const UNCLASSIFIED = TYPE_ORDER.filter(isUnclassified)
/** L45：类型筛选只在交互视角（L8）；运行视角的类型行只读 */
const shown = (t: RelationType) => props.run || desk.toggles.relationTypes.includes(t)
const toggleType = (t: RelationType) => {
  const list = desk.toggles.relationTypes
  desk.setToggles({ relationTypes: list.includes(t) ? list.filter(x => x !== t) : RELATION_TYPES.filter(x => x === t || list.includes(x)) })
}
/** L47：正文的类型行——开着且静息态画出来的、或关着的（常列淡色） */
const mainTypes = computed(() => TYPE_ORDER.filter(t => (shown(t) ? props.presence.has(`rel:type:${t}`) : true)))
const hasTypes = computed(() => mainTypes.value.length > 0)
/** 箭头一行：有异步（空心箭头）或经端口（插座）要解码时才列；全是实心箭头的画面没有可解码的 */
const hasArrow = computed(() => props.presence.has('rel:pair:async') || props.presence.has('rel:pair:port'))
const lookOf = (t: RelationType) => ({ type: t, weight: 2 as const })
/** 示意的箭头：通知一律异步（空心），其余按同步画实心 */
const arrowOf = (t: RelationType) => (t === 'notifies' ? 'open' : 'closed')
const typeTitle = (t: RelationType) => `${TYPE_LABEL[t]} = ${TYPE_HINT[t]}${props.run ? '' : '；单击切换显示，隐藏时画布角留痕计数'}`
</script>

<template>
  <section class="sec" aria-label="线">
    <div class="sec-title">
      线
      <button
        v-if="openGuide"
        class="help"
        title="怎么读一条线：三问定类型、四修饰（帮助 · 怎么读这张图）"
        aria-label="怎么读一条线"
        @click="openGuide('read-line')"
      >
        ?
      </button>
    </div>
    <div v-if="!hasTypes" class="item muted">本层没有画出来的关系</div>
    <template v-else>
      <div class="type-list">
        <template v-for="sec in [CLASSIFIED, UNCLASSIFIED]" :key="sec.join()">
          <div v-if="sec === UNCLASSIFIED && sec.some(t => mainTypes.includes(t))" class="section-label">迁移期</div>
          <template v-for="t in sec" :key="t">
            <div v-if="run" v-show="mainTypes.includes(t)" class="item" :data-type="t" :title="typeTitle(t)">
              <span class="sw"><LineSwatch :look="lookOf(t)" :arrow="arrowOf(t)" :width="36" /></span>
              <span>{{ TYPE_LABEL[t] }}</span>
            </div>
            <LegendToggle
              v-else
              v-show="mainTypes.includes(t)"
              :on="shown(t)"
              :label="TYPE_LABEL[t]"
              :title="typeTitle(t)"
              :data-type="t"
              @toggle="toggleType(t)"
            >
              <template #swatch><LineSwatch :look="lookOf(t)" :arrow="arrowOf(t)" :width="36" /></template>
            </LegendToggle>
          </template>
        </template>
      </div>

      <WidthRow v-if="presence.has('rel:weight')" />
      <div v-if="hasArrow" class="reading-row" data-testid="legend-arrow">
        <span class="dim">箭头</span>
        <template v-if="presence.has('rel:pair:async')">
          <span class="pair"><LineSwatch :color="NEUTRAL" :width="18" arrow="closed" />同步</span>
          <span class="pair" title="异步：空心箭头（通知一律异步，委托可同步可异步，L10）"><LineSwatch :color="NEUTRAL" :width="18" arrow="open" />异步</span>
        </template>
        <span v-if="presence.has('rel:pair:port')" class="pair" :title="`${VIA_KIND_HINTS.port}；标签与入口的插座并存（L12）`"
          ><LineSwatch :color="NEUTRAL" :width="26" arrow="closed" socket />经{{ VIA_KIND_LABELS.port }}</span
        >
      </div>
      <div v-if="presence.has('shared:dashed')" class="reading-row" data-testid="legend-linestyle">
        <span class="dim">线型</span>
        <span class="pair" :title="SHARED_TEXT.solid"><LineSwatch :color="NEUTRAL" :width="22" arrow="closed" />交互</span>
        <span class="pair" :title="SHARED_TEXT.dashed"><LineSwatch :color="NEUTRAL" :width="22" :look="{ temp: 'code' }" arrow="open" />依赖</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* 带箭头的类型示意比通用示意列宽一些，线不被箭头吃掉 */
.type-list :deep(.sw) {
  width: 36px;
}
</style>
