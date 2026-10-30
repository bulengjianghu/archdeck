<script setup lang="ts">
/**
 * 图例 · 组装（O12，交互视角）：第一行是开关行（L45，ADR-0056；缺省关，按项目记在本地，不进 URL）——开启后把组装事实（K13）投影到本层
 * 画叠加虚线（依赖，L18；依赖方一端实心菱形，同 L16 组装；不参与布局，单击落到代码依赖），组装根所在的节点标「组装根」角标。
 * 图例按上下文显示（L47，G14）：本层没有组装叠加线或组装根时对应行不列（出现集合由 state/desk/legend 一处派生）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import LegendToggle from './LegendToggle.vue'
import LineSwatch from './LineSwatch.vue'
import { ASSEMBLY_LINE_TEXT, ASSEMBLY_ROOT_TEXT, FACTS_HINT, TOGGLE_HINT, TOGGLE_LABEL } from './labels'

defineProps<{ open: boolean; presence: Set<string> }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()

const ready = computed(() => desk.facts.status.value === 'ready')
const hint = computed(() => (ready.value ? '' : FACTS_HINT[desk.facts.status.value]))
const on = computed(() => ready.value && !!desk.toggles.assembly)
const toggle = () => desk.setToggles({ assembly: !desk.toggles.assembly })
</script>

<template>
  <DisplayGroup title="组装" :open="open" @toggle="emit('toggle')">
    <LegendToggle
      :on="on"
      :label="TOGGLE_LABEL.assembly"
      :title="hint || TOGGLE_HINT.assembly"
      :disabled="!ready"
      data-testid="toggle-assembly"
      @toggle="toggle"
    >
      <template #swatch><LineSwatch :look="{ temp: 'assembly' }" arrow="open" /></template>
      {{ ready ? '谁把谁装起来' : `（${hint}）` }}
    </LegendToggle>
    <template v-if="on">
      <div v-if="!presence.has('asm:line') && !presence.has('asm:root')" class="item muted">本层没有组装事实</div>
      <div v-if="presence.has('asm:line')" class="item">
        <span class="sw"><LineSwatch :look="{ temp: 'assembly' }" arrow="open" /></span>
        <span>{{ ASSEMBLY_LINE_TEXT }}</span>
      </div>
      <div v-if="presence.has('asm:root')" class="item">
        <span class="sw"><span class="root">组装根</span></span
        ><span>{{ ASSEMBLY_ROOT_TEXT }}</span>
      </div>
    </template>
  </DisplayGroup>
</template>

<style scoped>
.root {
  padding: 0 4px;
  font-size: 10px;
  line-height: 14px;
  color: var(--assembly);
  border: 1px dashed var(--assembly);
  border-radius: 7px;
  white-space: nowrap;
}
</style>
