<script setup lang="ts">
/** 源码不可用时的提示（G1、G2）：正在读取 / 源码不在本地（附尝试的路径与覆盖方式）/ 构建产物不含源码 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'

const desk = useDesk()
const s = computed(() => desk.files.payload.value)
const envKey = computed(() => `ARCH_SOURCE_ROOT_${(desk.project ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '_')}`)
</script>

<template>
  <div class="source-status">
    <p v-if="!s">正在读取源码清单…</p>
    <template v-else-if="s.status === 'absent'">
      <p>
        <strong>源码不在本地</strong><template v-if="s.reason !== '源码不在本地'">：{{ s.reason }}</template>
      </p>
      <p v-if="s.repo" class="muted">
        描述中的 repo：<code>{{ s.repo }}</code>
      </p>
      <p v-if="s.tried" class="muted">
        尝试的路径：<code>{{ s.tried }}</code>
      </p>
      <p class="muted">
        可把源码放到上面的位置，或用环境变量 <code>{{ envKey }}</code
        >（或 <code>ARCH_WORKSPACE_ROOT</code>）指定后重启开发服务器。
      </p>
    </template>
    <p v-else-if="s.status === 'unavailable'"><strong>构建产物不含源码</strong>：请用 <code>npm run dev</code> 查看。</p>
  </div>
</template>

<style scoped>
.source-status {
  padding: 10px 14px;
  font-size: 12.5px;
  color: var(--text-2);
  line-height: 1.6;
}

.source-status p {
  margin: 0 0 6px;
}

code {
  word-break: break-all;
}
</style>
