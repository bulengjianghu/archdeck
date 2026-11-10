<script setup lang="ts">
/**
 * 对话里的机制图（DL-42，DA-6）：问答卡下与设计说明里共用。通过检查的图放进与图解同一机制的沙箱 iframe（explainerFrame：CSP、桥接脚本、引用按 EX-2 填），
 * 宽随资料区一列、高按 viewBox 比例，说明在图下；单击 data-arch——当前版本上同图解（revealModule，需要时换层次），草图里选中当前张的那个框。
 * 资料区不动（来源记为 'explainer'，选中的自动打开题解豁免，ADR-0061）。被拒的图（DL-41）只出「图被拒」与原因。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDesk } from '@/state/inject'
import type { DiagramView } from '@/state/desk/dialogue'
import { explainerSrcdoc, isExplainerMessage } from './explainerFrame'

const props = defineProps<{ view: DiagramView }>()
const desk = useDesk()
const frame = ref<HTMLIFrameElement | null>(null)

/** iframe 文档：只有这张 SVG；颜色随宿主的明暗（SVG 里用 currentColor） */
const DOC_STYLE = `<style>:root{color-scheme:light dark}html,body{margin:0;background:transparent;color:CanvasText;font:13px/1.4 system-ui,sans-serif}svg{display:block;width:100%;height:auto;max-width:100%}</style>`
const srcdoc = computed(() =>
  props.view.ok
    ? explainerSrcdoc(
        `<!doctype html><html><head><meta charset="utf-8">${DOC_STYLE}</head><body>${props.view.svg}</body></html>`,
        props.view.refs,
        window.location.origin,
      )
    : '',
)

function onMessage(e: MessageEvent) {
  if (!frame.value || e.source !== frame.value.contentWindow || !isExplainerMessage(e.data) || e.data.type !== 'arch:select') return
  const v = props.view
  const id = e.data.module
  if (!v.ok || !(id in v.refs)) return
  if (desk.edit.active.value) desk.select({ kind: 'module', id })
  else desk.revealModule(id)
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>

<template>
  <figure v-if="view.ok" class="diagram" data-testid="diagram">
    <iframe
      ref="frame"
      class="frame"
      :style="{ aspectRatio: `1 / ${view.aspect}` }"
      :title="`机制图 · ${view.caption}`"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      :srcdoc="srcdoc"
      data-testid="diagram-frame"
    />
    <figcaption data-testid="diagram-caption">{{ view.caption }}</figcaption>
  </figure>
  <div v-else class="diagram rejected" data-testid="diagram-rejected">
    图被拒（{{ view.caption }}），只显示文字：
    <ul>
      <li v-for="(r, n) in view.reasons" :key="n">{{ r }}</li>
    </ul>
  </div>
</template>

<style scoped>
.diagram {
  margin: 6px 0 0;
}

.frame {
  display: block;
  width: 100%;
  max-width: 640px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  /* 与图解同：iframe 里的文档随宿主明暗（EX-3） */
  color-scheme: light dark;
}

figcaption {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-2);
}

.rejected {
  padding: 6px 8px;
  border: 1px dashed var(--warn, var(--border));
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-2);
}

.rejected ul {
  margin: 4px 0 0;
  padding-left: 18px;
}
</style>
