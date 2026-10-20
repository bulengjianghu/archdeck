<script setup lang="ts">
/** 步骤树的一个节点（递归）：帧、组合框分组（loop · par 分支 · ref）、alt 及其分支；只画，不改状态 */
import { computed } from 'vue'
import type { OutlineNode } from '@/model'
import { fragmentText, frameText } from '../panel/runText'
import type { StepTreeContext } from './types'

defineOptions({ name: 'StepTreeNode' })
const props = defineProps<{ node: OutlineNode; depth: number; ctx: StepTreeContext }>()
const emit = defineEmits<{ seek: [id: string]; choose: [pointId: string, option: number]; toggle: [id: string]; hover: [id: string | null] }>()

const KIND_ICON = { call: '→', async: '⇢', return: '↩' } as const
const STATE_TEXT = { walked: '已走过', current: '当前', ahead: '未走到', unchosen: '未选分支', unreached: '未到达' } as const
const pad = (d: number) => ({ paddingLeft: `${8 + d * 14}px` })
const mark = computed(() => (props.node.kind === 'frame' ? props.ctx.mark(props.node.frame, props.node.status) : null))
const groupId = computed(() => (props.node.kind === 'group' ? `${props.node.tag.id}:${props.node.tag.branch ?? ''}` : props.node.kind === 'alt' ? props.node.pointId : ''))
const open = computed(() => !props.ctx.collapsed.has(groupId.value))
</script>

<template>
  <li v-if="node.kind === 'frame'" role="treeitem">
    <div
      class="frame"
      :class="[mark!.state, { hidden: mark!.hidden }]"
      :style="pad(depth)"
      :title="`${STATE_TEXT[mark!.state]}${mark!.hidden ? '，本层不可见' : ''}：单击指向该步`"
      @click="emit('seek', node.frame.id)"
      @mouseenter="emit('hover', node.frame.id)"
    >
      <span class="seq">{{ mark!.seq ?? '' }}</span>
      <span class="icon">{{ KIND_ICON[node.frame.kind] }}</span>
      <span class="text">{{ frameText(ctx.index, node.frame) }}</span>
      <span v-if="mark!.hidden" class="tag">本层不可见</span>
    </div>
  </li>

  <li v-else-if="node.kind === 'group'" role="treeitem" :aria-expanded="open">
    <div class="head" :style="pad(depth)" @click="emit('toggle', groupId)">
      <span class="caret">{{ open ? '▾' : '▸' }}</span>
      <span class="frag">{{ fragmentText(node.tag) }}</span>
    </div>
    <ul v-if="open" role="group">
      <StepTreeNode
        v-for="(c, k) in node.children"
        :key="k"
        :node="c"
        :depth="depth + 1"
        :ctx="ctx"
        @seek="i => emit('seek', i)"
        @choose="(p, o) => emit('choose', p, o)"
        @toggle="i => emit('toggle', i)"
        @hover="i => emit('hover', i)"
      />
    </ul>
  </li>

  <li v-else role="treeitem" :aria-expanded="open">
    <div class="head" :style="pad(depth)" @click="emit('toggle', groupId)">
      <span class="caret">{{ open ? '▾' : '▸' }}</span>
      <span class="frag">分支</span>
    </div>
    <ul v-if="open" role="group">
      <li v-for="o in node.options" :key="o.option" role="treeitem">
        <div
          class="option"
          :class="o.status"
          :style="pad(depth + 1)"
          :title="o.status === 'path' ? '已选分支' : '单击选这个分支'"
          @click="emit('choose', node.pointId, o.option)"
        >
          <span class="when">[{{ o.when }}]</span>
          <span v-if="o.status === 'path'" class="tag chosen">已选</span>
        </div>
        <ul role="group">
          <li v-if="o.children.length === 0" class="empty" :style="pad(depth + 2)">（空分支）</li>
          <StepTreeNode
            v-for="(c, k) in o.children"
            :key="k"
            :node="c"
            :depth="depth + 2"
            :ctx="ctx"
            @seek="i => emit('seek', i)"
            @choose="(p, q) => emit('choose', p, q)"
            @toggle="i => emit('toggle', i)"
            @hover="i => emit('hover', i)"
          />
        </ul>
      </li>
    </ul>
  </li>
</template>

<style scoped>
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.frame,
.head,
.option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 2px;
  padding-bottom: 2px;
  padding-right: 8px;
  cursor: pointer;
  white-space: nowrap;
  border-left: 2px solid transparent;
}

.frame:hover,
.head:hover,
.option:hover {
  background: var(--surface-2);
}

.seq {
  flex: none;
  min-width: 18px;
  text-align: right;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.icon {
  flex: none;
  color: var(--text-3);
}

.text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.walked .text {
  color: var(--text-2);
}

.ahead .text {
  color: var(--text);
}

.current {
  background: var(--accent-soft);
  border-left-color: var(--accent);
}

.current .text,
.current .seq {
  color: var(--accent);
  font-weight: 600;
}

.unchosen,
.unreached {
  opacity: 0.45;
}

.hidden .text {
  font-style: italic;
}

.caret {
  flex: none;
  width: 14px;
  font-size: 11px;
  color: var(--text-3);
}

.frag,
.when {
  font-size: 11.5px;
  color: var(--text-3);
}

.option.path .when {
  color: var(--text-2);
  font-weight: 600;
}

.tag {
  flex: none;
  font-size: 10.5px;
  color: var(--text-3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 4px;
}

.tag.chosen {
  color: var(--accent);
  border-color: var(--accent);
}

.empty {
  color: var(--text-3);
  font-size: 11.5px;
  padding-top: 2px;
  padding-bottom: 2px;
}
</style>
