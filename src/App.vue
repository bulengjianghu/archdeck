<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <!-- 切换项目或版本时重建视图，每个项目的每个版本一份独立状态 -->
  <RouterView v-slot="{ Component, route }">
    <component
      :is="Component"
      :key="[route.params.project ?? 'home', route.params.design, route.params.revision, route.params.commit, route.params.base].join('|')"
    />
  </RouterView>
</template>
