<script setup lang="ts">
/** 提交版本的根层面板（E5、E6）：哪个提交、提交说明、相对对比基线的变更清单 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import ChangeList from './ChangeList.vue'

const desk = useDesk()
const c = computed(() => desk.versions.commit.value!)
</script>

<template>
  <div class="commit-section">
    <header class="head">
      <h2>{{ c.subject || c.short }}</h2>
      <div class="badges">
        <code :title="c.hash">{{ c.short }}</code>
        <span class="badge warn">提交版本</span>
        <span v-if="c.date" class="badge">{{ c.date }}</span>
      </div>
      <p class="muted note">描述在这个 git 提交时的快照；只读，没有代码事实与归属警告（K8、G9）。</p>
    </header>
    <ChangeList />
  </div>
</template>

<style scoped>
.note {
  margin: 4px 0 0;
  font-size: 12px;
}
</style>
