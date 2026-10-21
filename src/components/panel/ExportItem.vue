<script setup lang="ts">
/** 入口导出的一项（G11）：名称、类别、经再导出时的来源文件、签名；对应到接口时标出接口 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import type { ExportedSymbol } from '@/model'
import CodeBlock from './CodeBlock.vue'

const props = defineProps<{ symbol: ExportedSymbol; interfaceId?: string; open?: boolean }>()
const desk = useDesk()
const KIND: Record<ExportedSymbol['kind'], string> = {
  function: '函数', class: '类', interface: '接口', type: '类型', enum: '枚举', const: '常量', namespace: '命名空间', default: '默认导出', reexport: '再导出',
}
const iface = computed(() => (props.interfaceId ? desk.index.value?.interfaces.get(props.interfaceId) : undefined))
</script>

<template>
  <details class="item" :open="open">
    <summary>
      <span class="name">{{ symbol.name }}</span>
      <span class="meta">{{ KIND[symbol.kind] }}</span>
      <code v-if="iface" class="id">↔ {{ iface.id }}</code>
    </summary>
    <div class="body">
      <div v-if="symbol.from" class="meta">
        声明在 <button class="link" @click="desk.selectFile(symbol.from)">{{ symbol.from }}</button>
      </div>
      <CodeBlock v-if="symbol.signature" :code="symbol.signature" />
    </div>
  </details>
</template>
