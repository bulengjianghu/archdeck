<script setup lang="ts">
/**
 * 图解的内容（EX-3、EX-4、EX-7，ADR-0055；LY-13、LY-15，ADR-0064）：顶部一行 ↑ ↓ 图解导航、「在画布上选中」与过期提示（可展开改动），下面是沙箱 iframe。
 * 导航不单独占一条带底线的栏：它是图解内容的第一行，iframe 按内容撑高（arch:size），整块在标签里一起滚动（负责人 2026-11-08 走查）。
 * iframe 只给 allow-scripts；父页只接受来源是这个 iframe 窗口的消息：arch:select 即选中模块（视图随主语跟随，LY-15），
 * arch:open 看另一份图解（选中它并激活图解标签），arch:hover 在画布上提示引用的位置（LY-15）。↑ ↓ 同 arch:open。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { BASIS_CHANGE_TEXT, staleText } from '../shared/explainerText'
import { explainerSrcdoc, isExplainerMessage } from './explainerFrame'
import { useRefPeek } from './useRefPeek'

const props = defineProps<{ module: string }>()
const desk = useDesk()
const ex = desk.explainers
const frame = ref<HTMLIFrameElement | null>(null)
const showChanges = ref(false)
/** iframe 内容的高度（arch:size）；没收到前给一个缺省高度 */
const frameHeight = ref<number | null>(null)

const name = (id: string) => (id === desk.index.value?.rootId ? desk.index.value.model.system.name : (desk.index.value?.modules.get(id)?.name ?? id))
const html = computed(() => ex.html(props.module))
const srcdoc = computed(() => (html.value ? explainerSrcdoc(html.value, ex.refs(props.module), window.location.origin) : ''))
const nav = computed(() => ex.nav(props.module))
const status = computed(() => ex.status(props.module))
const open = (id: string) => desk.readExplainer(id)
/** LY-15：iframe 里悬停引用，画布提示位置 */
const { peek } = useRefPeek()
onBeforeUnmount(() => peek(null))

function onMessage(e: MessageEvent) {
  if (!frame.value || e.source !== frame.value.contentWindow || !isExplainerMessage(e.data)) return
  if (e.data.type === 'arch:size') {
    frameHeight.value = e.data.height
    return
  }
  const id = e.data.module
  if (e.data.type === 'arch:hover') {
    peek(id || null)
    return
  }
  if (e.data.type === 'arch:open') {
    if (ex.has(id)) open(id)
  } else if (desk.index.value?.modules.has(id)) desk.revealModule(id)
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>

<template>
  <div class="explainer" :data-explainer="module">
    <div class="bar">
      <button v-if="nav.up" class="nav up" :title="`上一级图解：${name(nav.up)}`" @click="open(nav.up)">↑ {{ name(nav.up) }}</button>
      <span v-if="nav.down.length" class="downs">
        <button v-for="d in nav.down" :key="d" class="nav down" :title="`下一级图解：${name(d)}`" @click="open(d)">↓ {{ name(d) }}</button>
      </span>
      <span class="sp" />
      <button
        v-if="module !== desk.index.value?.rootId"
        class="nav sel"
        title="在画布上选中这个模块（资料区不动）"
        :data-ref-module="module"
        @click="desk.revealModule(module)"
      >
        在画布上选中
      </button>
      <button v-if="status?.stale" class="stale" :aria-expanded="showChanges" data-testid="explainer-stale" @click="showChanges = !showChanges">
        {{ staleText(status) }} {{ status.changes.length ? (showChanges ? '▴' : '▾') : '' }}
      </button>
    </div>
    <ul v-if="showChanges && status?.changes.length" class="changes">
      <li v-for="c in status.changes" :key="c.key">
        <span class="kind">{{ BASIS_CHANGE_TEXT[c.kind] }}</span> {{ c.label }}
      </li>
      <li class="muted">引用的原文已是现在的描述；核对讲法后由 AI 运行 <code>arch explainer --write</code> 更新依据</li>
    </ul>
    <iframe
      v-if="html"
      ref="frame"
      class="frame"
      :title="`图解 · ${name(module)}`"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      :srcdoc="srcdoc"
      :style="{ height: frameHeight === null ? '100%' : `${frameHeight}px` }"
    />
    <p v-else class="empty">「{{ name(module) }}」没有图解（描述里找不到它的图解文件）</p>
  </div>
</template>

<style scoped>
.explainer {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

/* 导航是内容的第一行：不画底线、跟着内容滚动 */
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px 0;
  font-size: 12px;
  flex: none;
  min-width: 0;
}

.bar:empty {
  display: none;
}

.downs {
  display: inline-flex;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.nav {
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: 10px;
  padding: 1px 8px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.nav:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.sp {
  flex: 1;
}

.stale {
  flex: none;
  border: 1px solid var(--warning);
  background: var(--warning-soft);
  color: var(--warning);
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 12px;
}

.changes {
  margin: 6px 16px 0;
  padding: 6px 12px 8px 28px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-2);
  background: var(--bg);
  flex: none;
}

.changes .kind {
  display: inline-block;
  min-width: 1.4em;
  color: var(--warning);
}

.muted {
  list-style: none;
  margin: 4px 0 0 -16px;
  color: var(--text-3);
}

.frame {
  flex: none;
  display: block;
  width: 100%;
  min-height: 120px;
  border: none;
  background: var(--surface);
  color-scheme: light dark;
}

.empty {
  margin: 0;
  padding: 30px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 12.5px;
}
</style>
