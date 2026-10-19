<script setup lang="ts">
import Handles from './Handles.vue'
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div class="band" :class="{ selected: data.selected, dim: data.dim, target: data.module?.status === 'target' }">
    <Handles />
    <div class="left">
      <div class="name">{{ data.name }}</div>
      <div class="abstraction">{{ data.band?.abstraction || '（未填写抽象原则）' }}</div>
    </div>
    <div class="right">
      <div class="label">可依赖</div>
      <div class="deps">{{ data.band?.mayDependOn.length ? data.band.mayDependOn.join(' · ') : '无' }}</div>
    </div>
  </div>
</template>

<style scoped>
.band {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--layer-bg);
  border: 1.5px solid var(--layer-border);
  border-radius: 12px;
  transition: opacity 0.15s;
}

.band.selected {
  border-color: var(--accent);
}

.band.dim {
  opacity: 0.45;
}

.band.target {
  border-style: dashed;
}

.left {
  position: absolute;
  left: 16px;
  top: 0;
  bottom: 0;
  width: 200px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.name {
  font-size: 16px;
  font-weight: 650;
}

.abstraction {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.right {
  position: absolute;
  right: 14px;
  top: 0;
  bottom: 0;
  width: 140px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  border-left: 1px solid var(--layer-border);
  padding-left: 12px;
}

.label {
  font-size: 11px;
  color: var(--text-3);
}

.deps {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
}
</style>
