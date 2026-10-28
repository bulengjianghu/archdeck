<script setup lang="ts">
/**
 * L37 ①：环编号（Y4）在名称行——身份的一部分，不与顶边的端口记号争位置；分层总览的带画在标题栏右上（band）。
 * L42（第十四轮 F10）：单击选中环组（V2，sel=y:<环编号>），环内的束画出、面板列成员与环内的依赖；悬停写环内收起的条数。
 */
import { inject } from 'vue'
import { DESK_STATE } from '@/state/inject'
import type { NodeData } from './types'

const props = defineProps<{ data: NodeData; band?: boolean }>()
const desk = inject(DESK_STATE, null)
const pick = () => {
  if (props.data.cycle !== undefined) desk?.select({ kind: 'cycle', id: String(props.data.cycle) })
}
</script>

<template>
  <button
    v-if="data.cycle !== undefined && !data.restHidden?.includes('cycle')"
    class="cycle-mark nodrag"
    :class="{ 'on-band': band, selected: data.cycleSelected }"
    data-testid="cycle-mark"
    :title="`本层的环 ${data.cycle}：与同编号的节点互相依赖${data.cycleHidden ? `；环内 ${data.cycleHidden} 条依赖静息态收起` : ''}（单击选中环组，画出环内的依赖）`"
    @click.stop="pick"
    @dblclick.stop
  >
    ↻ {{ data.cycle }}
  </button>
</template>

<style scoped>
.cycle-mark {
  flex: none;
  padding: 0 5px;
  font: inherit;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 15px;
  color: var(--danger);
  background: var(--surface);
  border: 1px solid var(--danger);
  border-radius: 8px;
  white-space: nowrap;
  cursor: pointer;
}

.cycle-mark.selected {
  color: var(--surface);
  background: var(--danger);
}

.cycle-mark.on-band {
  position: absolute;
  top: -9px;
  right: 10px;
  z-index: 1;
}
</style>
