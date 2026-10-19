<script setup lang="ts">
import { ref } from 'vue'
import { RELATION_TYPES } from '@/model'

const open = ref(true)
const LABEL: Record<string, string> = {
  depends: '依赖（编译期）',
  calls: '调用（控制权转移）',
  dataflow: '数据推送',
  event: '事件',
  implements: '实现端口 / 契约',
}
</script>

<template>
  <div class="legend">
    <button class="toggle" @click="open = !open">图例 {{ open ? '▾' : '▸' }}</button>
    <div v-if="open" class="body">
      <div v-for="t in RELATION_TYPES" :key="t" class="row"><span class="rel-chip" :class="`rel-${t}`">{{ LABEL[t] }}</span></div>
      <div class="row muted">线越粗 = 聚合的关系越多；点划线 = 异步</div>
      <div class="row"><span class="box" /> 模块 <span class="box stack" /> 可下钻 <span class="box dashed" /> 目标态 / 外部</div>
    </div>
  </div>
</template>

<style scoped>
.legend {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 5;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 12px;
  max-width: 300px;
}

.toggle {
  border: none;
  background: none;
  font-size: 12px;
  color: var(--text-2);
  padding: 4px 10px;
}

.body {
  padding: 0 10px 8px;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.9;
}

.box {
  display: inline-block;
  width: 14px;
  height: 10px;
  border: 1.5px solid var(--border-strong);
  border-radius: 3px;
  margin-left: 4px;
}

.box.stack {
  box-shadow: 2px 2px 0 -1px var(--surface), 2px 2px 0 0 var(--border-strong);
}

.box.dashed {
  border-style: dashed;
}
</style>
