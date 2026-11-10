<script setup lang="ts">
/** L14：边界角色记号——port（对外端口，压在框上边）、adapter（适配器，贴外部系统一侧的左边），跟在模块名后 */
defineProps<{ rim: 'port' | 'adapter' }>()
</script>

<template>
  <span
    class="rim-tag"
    :class="rim"
    :data-rim="rim"
    :title="
      rim === 'port'
        ? '对外端口（role: port）：系统对外的 API / 门面，画在框上边（用户一侧，L14）'
        : '适配器（role: adapter）：把外部技术接进来，画在框左边（外部系统一侧，L14）'
    "
    >{{ rim === 'port' ? '端口' : '适配器' }}</span
  >
</template>

<style scoped>
.rim-tag {
  flex: none;
  padding: 0 5px;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 15px;
  border-radius: 3px;
  border: 1px solid currentColor;
}

.rim-tag.port {
  color: var(--accent);
}

.rim-tag.adapter {
  color: var(--text-2);
  border-style: dashed;
}
</style>
