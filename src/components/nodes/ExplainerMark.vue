<script setup lang="ts">
/**
 * EX-5：有图解的模块在名称行加一枚 ▣——单击以预览标签打开它的图解（不改变选中、不下钻），双击固定。
 * 画在节点内、不改节点尺寸、不进布局（L30 计数不变）；运行视角与草图编辑态不显示。
 */
import { computed, inject } from 'vue'
import { DESK_STATE } from '@/state/inject'

const props = defineProps<{ moduleId: string; band?: boolean }>()
const desk = inject(DESK_STATE, null)
const shown = computed(() => !!desk && desk.perspective.value !== 'run' && !desk.edit.active.value && desk.explainers.has(props.moduleId))
const stale = computed(() => !!desk?.explainers.status(props.moduleId)?.stale)
const open = (pin: boolean) => desk?.workspace.open({ kind: 'explainer', module: props.moduleId }, pin)
</script>

<template>
  <button
    v-if="shown"
    class="explainer-mark nodrag"
    :class="{ 'on-band': band, stale }"
    data-testid="explainer-mark"
    :title="`图解：这个模块为什么这样设计${stale ? '（基于旧描述）' : ''}——单击预览，双击固定`"
    :aria-label="`打开图解${stale ? '（基于旧描述）' : ''}`"
    @click.stop="open(false)"
    @dblclick.stop="open(true)"
    @pointerdown.stop
  >
    ▣
  </button>
</template>

<style scoped>
.explainer-mark {
  flex: none;
  padding: 0 3px;
  border: none;
  background: none;
  font: inherit;
  font-size: 11px;
  line-height: 15px;
  color: var(--accent);
  opacity: 0.75;
  cursor: pointer;
}

.explainer-mark:hover {
  opacity: 1;
}

.explainer-mark.stale {
  color: var(--warning);
}

.explainer-mark.on-band {
  margin-left: 6px;
  font-size: 12px;
}
</style>
