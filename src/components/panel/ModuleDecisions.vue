<script setup lang="ts">
/**
 * 模块面板「相关决策」（E9，DV-13）：模块自己写的 `adrs`，列编号与标题（标题由接入层随源码清单给出）；文件在源码清单中时单击在副栏预览（同 E7），
 * 找不到文件的标出（提醒 module.adr-missing 在问题清单）。标题取 ADR 文件首个 `# ` 行。不继承：祖先写的决策折叠成「上级模块的决策 N 条」一行，展开列出，同样可单击预览。
 */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import Section from './Section.vue'
import { useOpenPreview } from '../shared/preview'

const props = defineProps<{ id: string; /** G11 V14c：⑤ 证据与细节缺省折叠 */ fold?: boolean }>()
const desk = useDesk()
const openPreview = useOpenPreview()
const local = computed(() => (desk.files.payload.value?.status === 'local' ? desk.files.payload.value : null))
const own = computed(() => desk.files.adrsOf(props.id))
const upper = computed(() => desk.files.ancestorAdrsOf(props.id))
const upperOpen = ref(false)
</script>

<template>
  <Section v-if="own.length || upper.length" title="相关决策" :count="own.length || undefined" :fold="props.fold">
    <ul v-if="own.length" class="plain adrs" data-testid="module-adrs">
      <li v-for="a in own" :key="a.n" :data-adr="a.n">
        <button v-if="a.file" class="link" :title="`在副栏预览 ${a.file}`" @click="openPreview(a.file)">{{ a.label }}</button>
        <code v-else class="missing" :title="local ? '源码根目录下找不到这个 ADR 文件' : '源码不可用'">{{ a.label }}</code>
        <span v-if="a.title" class="t">{{ a.title }}</span>
        <span v-else-if="!a.file && local" class="warn">找不到文件</span>
      </li>
    </ul>
    <p v-else class="muted">本模块没有写相关决策</p>
    <div v-if="upper.length" class="upper">
      <button class="fold" :aria-expanded="upperOpen" @click="upperOpen = !upperOpen">{{ upperOpen ? '▾' : '▸' }} 上级模块的决策 {{ upper.length }} 条</button>
      <ul v-if="upperOpen" class="plain">
        <li v-for="u in upper" :key="`${u.id}:${u.n}`" :data-adr="u.n">
          <button v-if="u.file" class="link" :title="`在副栏预览 ${u.file}`" @click="openPreview(u.file)">{{ u.label }}</button>
          <code v-else>{{ u.label }}</code>
          <span v-if="u.title" class="t"> {{ u.title }}</span>
          <span class="muted"> · {{ u.name }}</span>
        </li>
      </ul>
    </div>
  </Section>
</template>

<style scoped>
.adrs li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 2px 0;
}

.adrs .t,
.upper .t {
  color: var(--text-2);
  font-size: 12.5px;
}

.missing {
  color: var(--warning);
}

.warn {
  color: var(--warning);
  font-size: 12px;
}

.upper {
  margin-top: 6px;
  font-size: 12.5px;
}

.fold {
  padding: 0;
  font-size: 12.5px;
  color: var(--text-3);
  background: none;
  border: 0;
  cursor: pointer;
}
</style>
