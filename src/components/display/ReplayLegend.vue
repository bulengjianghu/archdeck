<script setup lang="ts">
/** 「显示」面板 · 回放（运行视角）：当前步骤、步骤序号、当前端点，以及经由上层、未建模、分支预览三种临时线（P10、P11、P15、F6） */
import DisplayGroup from './DisplayGroup.vue'
import LineSwatch from './LineSwatch.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <DisplayGroup title="回放" :open="open" @toggle="emit('toggle')">
    <div class="item">
      <span class="sw"><LineSwatch flow /></span>
      <span>当前步骤（沿消息方向流动）</span>
    </div>
    <div class="item">
      <span class="sw"><span class="badge">3</span></span
      ><span>已走过的步骤</span>
    </div>
    <div class="item">
      <span class="sw"><span class="badge muted">3</span></span
      ><span>其余已走的步骤（选中某步时）</span>
    </div>
    <div class="item">
      <span class="sw"><span class="box active" /></span><span>当前端点 / 内部活动</span>
    </div>
    <div class="item">
      <span class="sw"><LineSwatch :look="{ type: 'calls', temp: 'upper', weight: 2 }" /></span>
      <span>经由上层关系（类型色虚线，本层没有它的边）</span>
    </div>
    <div class="item">
      <span class="sw"><LineSwatch :look="{ temp: 'unmodeled' }" /></span>
      <span>结构中未建模</span>
    </div>
    <div class="item">
      <span class="sw"><LineSwatch :look="{ play: 'preview', weight: 2 }" /></span>
      <span>分支预览</span>
    </div>
  </DisplayGroup>
</template>

<style scoped>
.badge {
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  border-radius: 8px;
  border: 1px solid var(--accent);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}

.badge.muted {
  border-color: var(--border-strong);
  color: var(--text-3);
}
</style>
