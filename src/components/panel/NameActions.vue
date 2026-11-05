<script setup lang="ts">
/**
 * 名称行的动作槽（DL-17；身份卡在属性面板、事实卡在理解页，两处共用，放在属性面板目录）：按 nameActions 表渲染名称后的小链接；只发意图（打开图解、打开对话）。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { nameActions, type NameActionContext, type NameRowPlace } from './nameActions'

const props = defineProps<{ module: string; place: NameRowPlace }>()
const desk = useDesk()
const ctx = computed<NameActionContext>(() => ({
  hasExplainer: id => desk.explainers.has(id),
  current: !desk.version,
  sketching: desk.edit.active.value,
  openExplainer: id => desk.workspace.open({ kind: 'explainer', module: id }),
  openDialogue: id => desk.dialogue.open(id),
}))
const actions = computed(() => nameActions(props.place, props.module, ctx.value))
</script>

<template>
  <span v-if="actions.length" class="name-actions">
    <button v-for="a in actions" :key="a.id" class="link name-act" :data-action="a.id" :title="a.title" @click="a.run(ctx, module)">{{ a.label }}</button>
  </span>
</template>

<style scoped>
.name-actions {
  display: inline-flex;
  gap: 8px;
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  vertical-align: middle;
}

.name-act {
  white-space: nowrap;
}
</style>
