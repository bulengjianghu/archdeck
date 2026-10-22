<script setup lang="ts">
/**
 * 「显示」面板的设置：只放没有对应图例的开关——结构视角为边界节点、只看现状；
 * 运行视角为静态关系显示方式（V8），并用一行说明运行视角下舞台不受结构类开关影响（L9）。
 */
import { useDesk } from '@/state/inject'
import { useStage } from '../stage/useStageDisplay'
import { MODES, MODE_HINT, MODE_LABEL } from './labels'

defineProps<{ run: boolean }>()
const desk = useDesk()
const stage = useStage()
</script>

<template>
  <section class="settings">
    <div v-if="!run" class="setting">
      <label class="check"><input v-model="desk.toggles.showBoundaries" type="checkbox" /> 边界节点</label>
      <label class="check"><input v-model="desk.toggles.currentOnly" type="checkbox" /> 只看现状</label>
    </div>
    <template v-else>
      <div class="setting" role="group" aria-label="静态关系">
        <span class="setting-label">静态关系</span>
        <span class="segmented">
          <button
            v-for="m in MODES"
            :key="m"
            :class="{ on: stage.mode.value === m }"
            :aria-pressed="stage.mode.value === m"
            :title="MODE_HINT[m]"
            @click="stage.setMode(m)"
          >
            {{ MODE_LABEL[m] }}
          </button>
        </span>
      </div>
      <div class="info" title="运行视角下舞台不受边界节点、只看现状、关系类型筛选与代码事实影响；退出场景后恢复">ⓘ 场景中显示全部节点与关系类型</div>
    </template>
  </section>
</template>

<style scoped>
.settings {
  padding-bottom: 8px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

.setting {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 24px;
}

.setting-label {
  color: var(--text-2);
  white-space: nowrap;
}

.check {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  color: var(--text-2);
}

.segmented {
  display: inline-flex;
  margin-left: -6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.segmented button {
  border: none;
  border-radius: 0;
  background: none;
  padding: 1px 10px;
  font: inherit;
  color: var(--text-2);
  white-space: nowrap;
}

.segmented button + button {
  border-left: 1px solid var(--border);
}

.segmented button.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.info {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-3);
  cursor: help;
}
</style>
