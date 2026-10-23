<script setup lang="ts">
/**
 * 草图的面包屑（F-27、#15，临时放在画布顶部；T2b 移到信息条身份区）：从根到当前张的挂载点，点一级返回（会话里没有时推出）；
 * 父级也是升级的落点——拖节点到它上面松手 = 升级（F-26），拖动经过时高亮。
 */
import { useDesk } from '@/state/inject'

defineProps<{ dropParent?: boolean }>()
const emit = defineEmits<{ notice: [text: string] }>()
const desk = useDesk()

function go(mount: string) {
  const r = desk.edit.goUp(mount)
  if (!r.ok) emit('notice', r.reason)
}
</script>

<template>
  <nav class="sk-crumbs" aria-label="草图面包屑">
    <span class="lead">挂在：</span>
    <template v-for="(c, i) in desk.edit.breadcrumb.value" :key="c.mount">
      <span v-if="i" class="sep">›</span>
      <button
        v-if="i < desk.edit.breadcrumb.value.length - 1"
        class="crumb"
        :class="{ drop: dropParent && i === desk.edit.breadcrumb.value.length - 2, derived: !c.open }"
        :data-crumb="c.mount"
        :data-parent="i === desk.edit.breadcrumb.value.length - 2 ? '1' : undefined"
        :title="i === desk.edit.breadcrumb.value.length - 2 ? '返回上一层；把节点拖到这里 = 升级到父层' : '返回这一层'"
        @click="go(c.mount)"
      >
        {{ c.name }}
      </button>
      <strong v-else class="here" :data-crumb="c.mount">{{ c.name }}</strong>
    </template>
  </nav>
</template>

<style scoped>
.sk-crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 12.5px;
}

.lead {
  color: var(--text-3);
}

.sep {
  color: var(--text-3);
}

.crumb {
  border: 1px solid transparent;
  background: none;
  padding: 1px 6px;
  border-radius: 6px;
  color: var(--accent);
}

.crumb.derived {
  color: var(--text-2);
}

.crumb.drop {
  border: 2px dashed var(--warning);
  background: var(--warning-soft);
}

.here {
  padding: 1px 6px;
}
</style>
