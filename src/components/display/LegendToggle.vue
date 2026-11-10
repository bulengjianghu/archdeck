<script setup lang="ts">
/**
 * 图例的开关行（L45，ADR-0056；QGIS 图层行的做法）：一行 = 勾选态 + 示意 + 名称，单击整行切换开关；关着的行淡色（L47：关着也常列，才能再打开）。
 * 不可用时（代码事实未就绪、没有演化事实）置灰、悬停写明原因。
 */
defineProps<{ on: boolean; label: string; title?: string; disabled?: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    class="item toggle"
    :class="{ off: !on }"
    role="switch"
    :aria-checked="on"
    :aria-label="label"
    :title="title"
    :disabled="disabled"
    @click="emit('toggle')"
  >
    <span class="tick" aria-hidden="true">{{ on ? '✓' : '' }}</span>
    <span class="sw"><slot name="swatch" /></span>
    <span class="text"
      >{{ label }}<span v-if="$slots.default" class="hint"> <slot /></span
    ></span>
  </button>
</template>

<style scoped>
.toggle {
  border: none;
  background: none;
  padding: 0 4px 0 0;
  margin: 0 -4px 0 0;
  border-radius: 4px;
  font: inherit;
  cursor: pointer;
}

.toggle:hover:not(:disabled) {
  background: var(--surface-2);
}

.toggle.off .sw,
.toggle.off .text {
  opacity: 0.4;
}

.toggle:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.tick {
  flex: none;
  width: 12px;
  height: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  color: var(--accent);
  border: 1px solid var(--border-strong);
  border-radius: 3px;
}

.text {
  min-width: 0;
}

.hint {
  color: var(--text-3);
}
</style>
