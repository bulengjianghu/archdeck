<script setup lang="ts">
import { ref, watch } from 'vue'
import { RELATION_TYPES } from '@/model'
import { useDesk } from '@/state/inject'
import { useStage } from './stage/useStageDisplay'

const desk = useDesk()
const stage = useStage()
const MODE_LABEL = { hide: '隐藏', dim: '淡显', show: '全显' } as const
// 运行视角下画布变矮，进入时先收起图例
const open = ref(desk.perspective.value !== 'run')
watch(desk.perspective, p => (open.value = p !== 'run'))
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
      <div v-for="t in RELATION_TYPES" :key="t" class="row">
        <span class="rel-chip" :class="`rel-${t}`">{{ LABEL[t] }}</span>
      </div>
      <div class="row muted">线越粗 = 聚合的关系越多；点划线 = 异步</div>
      <div class="row"><span class="box" /> 模块 <span class="box stack" /> 可下钻 <span class="box dashed" /> 目标态 / 外部</div>
      <template v-if="desk.perspective.value === 'run'">
        <div class="row head">回放</div>
        <div class="row"><span class="flow" /> 当前步骤（沿消息方向流动） <span class="num">3</span> 已走过的步骤</div>
        <div class="row"><span class="box active" /> 当前端点 / 内部活动 <span class="line unmodeled" /> 结构中未建模</div>
        <div class="row"><span class="line preview" /> 分支预览 · 时序图：实线实心箭头 = 同步，虚线开放箭头 = 异步，点线 = 返回</div>
        <div class="row muted">灰色 = 选中步骤时其余已走的步骤 · 静态关系：{{ MODE_LABEL[stage.mode.value] }}（左下角切换）</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.head {
  margin-top: 4px;
  font-weight: 600;
  color: var(--text-2);
}

.flow,
.line {
  display: inline-block;
  width: 22px;
  height: 0;
  vertical-align: middle;
  border-top: 3px dashed var(--accent);
}

.line.unmodeled {
  border-top: 2px dashed var(--danger);
}

.line.preview {
  border-top: 2px dashed var(--warning);
}

.num {
  display: inline-block;
  min-width: 16px;
  font-size: 10px;
  font-weight: 700;
  text-align: center;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 8px;
}

.box.active {
  box-shadow: 0 0 0 2px var(--accent);
}

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
  box-shadow:
    2px 2px 0 -1px var(--surface),
    2px 2px 0 0 var(--border-strong);
}

.box.dashed {
  border-style: dashed;
}
</style>
