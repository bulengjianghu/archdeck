<script setup lang="ts">
/**
 * 「显示」面板 · 组装（O12，交互视角）：开启后把组装事实（K13）投影到本层画叠加虚线（依赖，L18；依赖方一端实心菱形，同 L16 组装；不参与布局，单击落到代码依赖），
 * 组装根所在的节点标「组装根」角标。开关在设置块的「代码事实与组装」组（L45，第十五轮 G13 迁出；缺省关，按项目记在本地，不进 URL），
 * 组标题旁互指。图例按上下文显示（L47，G14）：本层没有组装叠加线或组装根时对应行不列（出现集合由 state/desk/legend 一处派生）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import DisplayGroup from './DisplayGroup.vue'
import LineSwatch from './LineSwatch.vue'
import { FACTS_HINT } from './labels'

defineProps<{ open: boolean; presence: Set<string> }>()
const emit = defineEmits<{ toggle: [] }>()
const desk = useDesk()

const ready = computed(() => desk.facts.status.value === 'ready')
const hint = computed(() => (ready.value ? '' : FACTS_HINT[desk.facts.status.value]))
</script>

<template>
  <DisplayGroup title="组装" :open="open" @toggle="emit('toggle')">
    <template #actions>
      <span class="aside-note">开关在设置 · 组装</span>
    </template>
    <div v-if="!ready" class="item muted">{{ hint }}</div>
    <div v-else-if="!desk.toggles.assembly" class="item muted">已关闭：在「设置 · 组装」打开后叠加组装事实（谁把谁装起来），标出组装根</div>
    <div v-else-if="!presence.has('asm:line') && !presence.has('asm:root')" class="item muted">本层没有组装事实（谁把谁装起来）</div>
    <template v-else>
      <div v-if="presence.has('asm:line')" class="item">
        <span class="sw"><LineSwatch :look="{ temp: 'assembly' }" arrow="open" /></span>
        <span>虚线 + 实心菱形 = 组装（new / 工厂 / 注册，菱形在组装者一端，不参与布局）</span>
      </div>
      <div v-if="presence.has('asm:root')" class="item">
        <span class="sw"><span class="root">组装根</span></span
        ><span>组装了别的模块、自身不被组装</span>
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

.aside-note {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-3);
}
</style>
