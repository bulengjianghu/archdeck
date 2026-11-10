<script setup lang="ts">
/** 草图画布的右键菜单（F-24、F-25、F-27、F-30）：位置与条目由画布给出，点一项发出它的键；Esc 或点别处关闭 */
import { onBeforeUnmount, onMounted } from 'vue'

export interface MenuItem {
  key: string
  label: string
  danger?: boolean
  disabled?: boolean
}

defineProps<{ x: number; y: number; items: MenuItem[] }>()
const emit = defineEmits<{ choose: [key: string]; close: [] }>()
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close')
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="sk-menu-mask" @click="emit('close')" @contextmenu.prevent="emit('close')">
    <ul class="sk-menu" role="menu" :style="{ left: `${x}px`, top: `${y}px` }" @click.stop>
      <li v-for="it in items" :key="it.key">
        <button role="menuitem" :class="{ danger: it.danger }" :disabled="it.disabled" @click="emit('choose', it.key)">{{ it.label }}</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.sk-menu-mask {
  position: fixed;
  inset: 0;
  z-index: 40;
}

.sk-menu {
  position: fixed;
  margin: 0;
  padding: 4px;
  list-style: none;
  min-width: 160px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgb(0 0 0 / 15%);
}

.sk-menu button {
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  padding: 5px 10px;
  font-size: 12.5px;
  border-radius: 5px;
}

.sk-menu button:hover:not(:disabled) {
  background: var(--accent-soft);
}

.sk-menu button.danger {
  color: var(--danger);
}
</style>
