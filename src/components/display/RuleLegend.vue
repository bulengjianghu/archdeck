<script setup lang="ts">
/**
 * 图例 · 规则叠加（结构视角，U15、U17）：每条结构边按 mayDependOn 判定允许 / 违规，只标违规（违规红晕是共享通道，L18）；
 * 允许与无约束同样式，是哪条规则允许在悬停与面板里写明。U17 的「逆稳定」是浅色提示记号（info，不进门禁）。
 * 图例按上下文显示（L47，G14）：只列本层画出来的违规红晕、允许边与逆稳定提示（出现集合由 state/desk/legend 一处派生）；
 * 本层没有这些记号时一行说明（空态口径：说明为什么没有）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import StructureSwatch from './StructureSwatch.vue'

const props = defineProps<{ open: boolean; presence: Set<string> }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()
const empty = computed(
  () =>
    desk.facts.status.value === 'ready' && !props.presence.has('rule:violation') && !props.presence.has('rule:allowed') && !props.presence.has('rule:against'),
)
</script>

<template>
  <DisplayGroup title="规则叠加 · 只标违规" :open="open" @toggle="emit('toggle')">
    <div v-if="empty" class="item muted">本层没有违规或逆稳定的记号（只标违规，允许边不标）</div>
    <template v-else>
      <div v-if="presence.has('rule:violation')" class="item">
        <span class="sw kind"><StructureSwatch halo /></span>
        <span>违规：红晕（新增与无基线；已知的淡红晕，已豁免灰描边）</span>
      </div>
      <div v-if="presence.has('rule:allowed')" class="item">
        <span class="sw kind"><StructureSwatch /></span>
        <span>允许 / 无约束：不加标记，悬停与面板写明是哪条规则允许</span>
      </div>
      <div v-if="presence.has('rule:against')" class="item">
        <span class="sw kind"><span class="chip">逆稳定</span></span>
        <span>提示：稳定的模块依赖了更易变的（只提示，不计违规）</span>
      </div>
    </template>
  </DisplayGroup>
</template>

<style scoped>
.sw.kind {
  width: 36px;
}
</style>
