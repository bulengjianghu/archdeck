<script setup lang="ts">
/**
 * EX-5（LY-15 修订）：有图解的模块在名称行加一枚 ▣——单击即选中这个模块并激活图解标签（不下钻）。
 * 画在节点内、不改节点尺寸、不进布局（L30 计数不变）；运行视角与草图编辑态不显示。
 */
import { computed, inject } from 'vue'
import { DESK_STATE } from '@/state/inject'

const props = defineProps<{ moduleId: string; band?: boolean }>()
const desk = inject(DESK_STATE, null)
const shown = computed(() => !!desk && desk.perspective.value !== 'run' && !desk.edit.active.value && desk.explainers.has(props.moduleId))
const stale = computed(() => !!desk?.explainers.status(props.moduleId)?.stale)
const open = () => desk?.readExplainer(props.moduleId)
</script>

<template>
  <button
    v-if="shown"
    class="explainer-mark nodrag"
    :class="{ 'on-band': band, stale }"
    data-testid="explainer-mark"
    :title="`图解：这个模块为什么这样设计${stale ? '（基于旧描述）' : ''}——单击看图解`"
    :aria-label="`打开图解${stale ? '（基于旧描述）' : ''}`"
    @click.stop="open()"
    @dblclick.stop
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
