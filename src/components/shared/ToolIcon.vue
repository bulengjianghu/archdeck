<script setup lang="ts">
/** 工具栏与资料区标签栏的图标（TB-2）：16px 线框 SVG，颜色随按钮（currentColor） */
defineProps<{ name: 'nav' | 'search' | 'focus' | 'props' | 'dock' | 'more' | 'split' | 'close' | 'modules' | 'scenes' | 'changes' }>()
</script>

<template>
  <svg
    class="tool-icon"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'nav'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </template>
    <template v-else-if="name === 'focus'"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></template>
    <template v-else-if="name === 'props'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </template>
    <template v-else-if="name === 'dock'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16M15 9h3M15 13h3" />
    </template>
    <template v-else-if="name === 'more'">
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </template>
    <template v-else-if="name === 'split'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 12h18" />
    </template>
    <!-- LY-3（负责人 2026-11-08 走查）：侧栏竖栏的三页 -->
    <template v-else-if="name === 'modules'">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </template>
    <template v-else-if="name === 'scenes'">
      <path d="M5 4.5v15M5 6.5h11M5 12h14M5 17.5h8.5" />
      <path d="M15 4.5 17 6.5l-2 2M17 10l2 2-2 2M12 15.5l2 2-2 2" />
    </template>
    <template v-else-if="name === 'changes'">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </template>
    <template v-else><path d="M6 6l12 12M18 6 6 18" /></template>
  </svg>
</template>

<style scoped>
.tool-icon {
  display: block;
  flex: none;
}
</style>
