<script setup lang="ts">
/**
 * 面板骨架 ③「需要注意」（G11、ADR-0050、V15b）：每类异常一行、带计数，单击跳到对应节（折叠节自动展开并滚动到位）；
 * 全部无异常时整段不出现。异常清单与计数由各面板从现有派生给出（不新算），这里只排序与呈现。
 * 问题级（违规、环、未解释、未证实、确认过期）用危险色，提示级（拆分信号、逆稳定、表面）用警示色。
 */
import { computed } from 'vue'
import Section from './Section.vue'
import { jumpToSection, orderNotices, type PanelNotice } from './panelNotices'

const props = defineProps<{ notices: PanelNotice[] }>()
const rows = computed(() => orderNotices(props.notices))
</script>

<template>
  <Section v-if="rows.length" title="需要注意" class="notice-sec" data-sec="notices">
    <button
      v-for="n in rows"
      :key="n.key"
      class="notice"
      :class="{ hint: n.hint }"
      :title="`跳到「${n.to}」`"
      :data-notice="n.key"
      @click="jumpToSection(n.target)"
    >
      <b>{{ n.label }}</b> {{ n.count }}<span class="muted"> → {{ n.to }}</span>
    </button>
  </Section>
</template>

<style scoped>
.notice {
  display: block;
  width: 100%;
  padding: 3px 0;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  color: var(--danger);
  background: none;
  border: none;
  cursor: pointer;
}

.notice.hint {
  color: var(--warning);
}

.notice b {
  margin-right: 6px;
}

.notice .muted {
  color: var(--text-3);
}

.notice:hover {
  text-decoration: underline;
}
</style>
