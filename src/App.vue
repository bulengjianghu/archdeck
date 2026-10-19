<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <!-- 切换项目时重建视图，每个项目一份独立状态 -->
  <RouterView v-slot="{ Component, route }">
    <component :is="Component" :key="String(route.params.project ?? 'home')" />
  </RouterView>
</template>
