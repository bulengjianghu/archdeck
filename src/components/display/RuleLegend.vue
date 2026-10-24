<script setup lang="ts">
/**
 * 「显示」面板 · 规则叠加（结构视角，U15、U17）：每条结构边按 mayDependOn 判定允许 / 违规，只标违规（违规红晕是共享通道，L18）；
 * 允许与无约束同样式，是哪条规则允许在悬停与面板里写明。U17 的「逆稳定」是浅色提示记号（info，不进门禁）。
 */
import DisplayGroup from './DisplayGroup.vue'
import StructureSwatch from './StructureSwatch.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <DisplayGroup title="规则叠加 · 只标违规" :open="open" @toggle="emit('toggle')">
    <div class="item">
      <span class="sw kind"><StructureSwatch halo /></span>
      <span>违规：红晕（新增与无基线；已知的淡红晕，已豁免灰描边）</span>
    </div>
    <div class="item">
      <span class="sw kind"><StructureSwatch /></span>
      <span>允许 / 无约束：不加标记，悬停与面板写明是哪条规则允许</span>
    </div>
    <div class="item">
      <span class="sw kind"><span class="chip">逆稳定</span></span>
      <span>提示：稳定的模块依赖了更易变的（只提示，不计违规）</span>
    </div>
  </DisplayGroup>
</template>

<style scoped>
.sw.kind {
  width: 36px;
}
</style>
