<script setup lang="ts">
/** 右键菜单（C-6、C-7、C-10）：节点——核心（只第二级）、封闭、删除；边——删除。每项只发一个编辑操作 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { confirmRemove } from './useEditKeys'

const props = defineProps<{ x: number; y: number; target: { kind: 'module' | 'relation'; id: string } }>()
const emit = defineEmits<{ close: []; notice: [msg: string] }>()
const desk = useDesk()
const module = computed(() => (props.target.kind === 'module' ? desk.index.value?.modules.get(props.target.id) : undefined))
/** 04 §3.2：核心只用于第二级模块（父为层） */
const secondLevel = computed(() => !!module.value && desk.index.value?.modules.get(module.value.parentId)?.kind === 'layer')
const closed = computed(() => !!desk.edit.draft.value?.closed?.includes(props.target.id))

function run(fn: () => { ok: boolean; reason?: string } | Promise<string>) {
  emit('close')
  void Promise.resolve(fn()).then(r => {
    const msg = typeof r === 'string' ? r : r.ok ? '' : (r.reason ?? '')
    if (msg) emit('notice', msg)
  })
}
</script>

<template>
  <div class="mask" @click="emit('close')" @contextmenu.prevent="emit('close')">
    <ul class="menu" role="menu" :style="{ left: `${x}px`, top: `${y}px` }" @click.stop>
      <template v-if="module">
        <li v-if="secondLevel" role="menuitem" @click="run(() => desk.edit.edit({ op: 'updateModule', id: target.id, patch: { core: !module!.core } }))">
          {{ module.core ? '取消核心' : '标为核心' }}
        </li>
        <li role="menuitem" @click="run(() => desk.edit.edit({ op: 'setClosed', id: target.id, closed: !closed }))">{{ closed ? '取消封闭' : '标为封闭' }}</li>
      </template>
      <li role="menuitem" class="danger" @click="run(() => confirmRemove(desk, target))">删除</li>
    </ul>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 40;
}

.menu {
  position: fixed;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  min-width: 120px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgb(0 0 0 / 14%);
  font-size: 12.5px;
}

.menu li {
  padding: 4px 12px;
  cursor: pointer;
}

.menu li:hover {
  background: var(--surface-2);
}

.danger {
  color: var(--danger);
}
</style>
