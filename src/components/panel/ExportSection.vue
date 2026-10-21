<script setup lang="ts">
/**
 * 入口导出（G11、G12）：按名称与模块的 provides 对应，分「已对应」「导出未描述」「描述未导出」三组。
 * moduleIds 为空时（文件面板中不是任何模块的入口）只列出导出。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import Section from './Section.vue'
import ExportItem from './ExportItem.vue'
import InterfaceItem from './InterfaceItem.vue'

const props = defineProps<{ file: string; moduleId?: string }>()
const desk = useDesk()
const res = computed(() => desk.files.exports(props.file).value)
const symbols = computed(() => (res.value.status === 'ok' ? res.value.value : []))
const match = computed(() => (props.moduleId ? desk.files.exportMatch(props.moduleId, symbols.value) : null))
const few = computed(() => symbols.value.length <= 3)
</script>

<template>
  <Section title="入口导出" :count="res.status === 'ok' ? symbols.length : undefined">
    <p v-if="res.status === 'loading'" class="muted">正在解析导出…</p>
    <p v-else-if="res.status !== 'ok'" class="muted">无法解析导出{{ res.status === 'error' ? `：${res.message}` : '' }}</p>
    <p v-else-if="!symbols.length" class="muted">没有导出</p>
    <template v-else-if="match">
      <div v-if="match.matched.length" class="group">
        <div class="sub ok">已对应描述的接口 {{ match.matched.length }}</div>
        <ExportItem v-for="m in match.matched" :key="m.symbol.name" :symbol="m.symbol" :interface-id="m.interfaceId" :open="few" />
      </div>
      <div v-if="match.undescribed.length" class="group">
        <div class="sub warn">导出了但描述里没有 {{ match.undescribed.length }}</div>
        <ExportItem v-for="s in match.undescribed" :key="s.name" :symbol="s" :open="few" />
      </div>
      <div v-if="match.unexported.length" class="group">
        <div class="sub warn">描述里有但入口没导出 {{ match.unexported.length }}</div>
        <InterfaceItem v-for="id in match.unexported" :key="id" :id="id" />
      </div>
    </template>
    <ExportItem v-for="s in symbols" v-else :key="s.name" :symbol="s" :open="few" />
  </Section>
</template>

<style scoped>
.group + .group {
  margin-top: 10px;
}

.sub {
  font-size: 12px;
  font-weight: 600;
}

.sub.ok {
  color: var(--rel-dataflow);
}

.sub.warn {
  color: var(--warning);
}
</style>
