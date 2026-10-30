<script setup lang="ts">
import Handles from './Handles.vue'
import DiffMark from './DiffMark.vue'
import StructMarks from './StructMarks.vue'
import CycleMark from './CycleMark.vue'
import ExplainerMark from './ExplainerMark.vue'
import LayerStatus from './LayerStatus.vue'
import type { NodeData } from './types'

defineProps<{ data: NodeData }>()
</script>

<template>
  <div class="band" :class="{ selected: data.selected, dim: data.dim, target: data.module?.status === 'target', [`diff-${data.change}`]: !!data.change }">
    <Handles />
    <DiffMark :data="data" />
    <StructMarks :data="data" />
    <CycleMark :data="data" band />
    <div class="left">
      <div class="name">
        {{ data.name }}<LayerStatus v-if="data.band?.status" :status="data.band.status" /><ExplainerMark :module-id="data.moduleId" band />
      </div>
      <div class="abstraction">{{ data.band?.abstraction || '（未填写抽象原则）' }}</div>
    </div>
    <span v-if="data.counts" class="counts" data-testid="band-counts">共用件 {{ data.counts.shared }} · 折叠 {{ data.counts.folded }}</span>
    <span v-if="data.shelfAt !== undefined" class="shelf-label" :style="{ top: `${data.shelfAt}px` }">共用件</span>
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

/* O11：计数标签在上边框左端（标题栏之上）——块的端口短桩与空隙里的轨道都不经过这里（L30） */
.counts {
  position: absolute;
  top: -9px;
  left: 16px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 16px;
  color: var(--text-3);
  background: var(--layer-bg);
  border-radius: 8px;
}

.shelf-label {
  position: absolute;
  left: 250px;
  transform: translateY(-50%);
  font-size: 11px;
  color: var(--text-3);
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
