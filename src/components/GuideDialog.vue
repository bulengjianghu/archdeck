<script setup lang="ts">
/**
 * 「怎么读这张图」（W-10）：顶栏「帮助」打开的一页，按结构 / 运行 / 对照与治理三组各一句话加示意；
 * 只讲概念，线型、颜色等具体图例在画布右下角的「显示」面板。Esc 或单击遮罩关闭。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { RELATION_TYPE_LABELS, THREE_QUESTIONS } from './shared/labels'

const emit = defineEmits<{ close: [] }>()
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <section class="guide" role="dialog" aria-modal="true" aria-label="怎么读这张图">
      <header>
        <h2>怎么读这张图</h2>
        <button class="close" aria-label="关闭" @click="emit('close')">×</button>
      </header>
      <p class="lead">本地架构工作台：<strong>看见</strong>结构与运行，<strong>对照</strong>描述与代码，<strong>守住</strong>规则与门禁。</p>

      <div class="group">
        <svg viewBox="0 0 120 64" aria-hidden="true">
          <rect x="4" y="6" width="112" height="22" rx="4" class="band" />
          <rect x="12" y="11" width="34" height="12" rx="3" class="node" />
          <rect x="4" y="36" width="112" height="22" rx="4" class="band" />
          <rect x="62" y="41" width="34" height="12" rx="3" class="node" />
          <path d="M29 23 L79 41" class="edge" marker-end="url(#g-arrow)" />
          <defs>
            <marker id="g-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" class="head" />
            </marker>
          </defs>
        </svg>
        <div>
          <h3>结构</h3>
          <p>方框是模块、带是层、有向线是关系（颜色表类型，×N 是聚合了几条）；一次只看一层，双击下钻，带里的「+N」单击临时展开其余模块。</p>
        </div>
      </div>

      <div class="group" aria-label="读一条线：三问四修饰">
        <svg viewBox="0 0 120 64" aria-hidden="true">
          <path d="M10 18 L98 18" class="edge query" marker-end="url(#g-arrow)" />
          <path d="M10 40 L98 40" class="edge" marker-end="url(#g-arrow)" />
          <path d="M94 33 A7 7 0 0 1 94 47" class="socket" />
        </svg>
        <div>
          <h3>读一条线：三问四修饰</h3>
          <ol class="questions">
            <li v-for="(x, i) in THREE_QUESTIONS" :key="i">{{ x.q }}{{ x.answers.map(a => `${a.a} → ${RELATION_TYPE_LABELS[a.type]}`).join('；') }}</li>
          </ol>
          <p>
            再读修饰：经什么连（直接 / 端口——目标端的插座记号 / 总线 /
            通道）、异步（空心箭头）、拉取。查询画得淡，委托实色；端口是方框进边一侧的小记号，单击看实现者与使用者。
          </p>
        </div>
      </div>

      <div class="group">
        <svg viewBox="0 0 120 64" aria-hidden="true">
          <line x1="22" y1="8" x2="22" y2="60" class="life" />
          <line x1="62" y1="8" x2="62" y2="60" class="life" />
          <line x1="102" y1="8" x2="102" y2="60" class="life" />
          <path d="M22 20 L60 20" class="edge" marker-end="url(#g-arrow)" />
          <path d="M62 34 L100 34" class="edge now" marker-end="url(#g-arrow)" />
          <path d="M100 48 L64 48" class="edge ret" marker-end="url(#g-arrow)" />
        </svg>
        <div>
          <h3>运行</h3>
          <p>顶部「运行」选一个场景，结构图变成舞台、旁边出现时序图；逐步前进，每一步都是一次真实的调用或推送，下钻后步骤变细。</p>
        </div>
      </div>

      <div class="group">
        <svg viewBox="0 0 120 64" aria-hidden="true">
          <rect x="6" y="8" width="34" height="14" rx="3" class="node" />
          <rect x="80" y="8" width="34" height="14" rx="3" class="node" />
          <rect x="6" y="42" width="34" height="14" rx="3" class="node" />
          <rect x="80" y="42" width="34" height="14" rx="3" class="node" />
          <path d="M40 15 L80 15" class="edge dashed" />
          <text x="60" y="12" class="mark">?</text>
          <path d="M40 49 L80 49" class="edge dotted" />
          <path d="M23 22 L97 42" class="edge bad" />
        </svg>
        <div>
          <h3>对照与治理</h3>
          <p>
            代码事实缺省叠加：虚线加 ? 是代码里找不到的关系，点线是代码有而描述没写的依赖，红色是基线外新增的违规，↻
            是本层的环；所有问题汇总在导航树「问题」页签，可复制给 agent 返工。
          </p>
        </div>
      </div>

      <p class="foot muted">线型、颜色与节点样式的完整图例在画布右下角的「显示」面板。</p>
    </section>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 28%);
}

.guide {
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 16px 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 18%);
}

header {
  display: flex;
  align-items: center;
}

h2 {
  margin: 0;
  font-size: 16px;
}

.close {
  margin-left: auto;
  border: none;
  background: none;
  font-size: 18px;
}

.questions {
  margin: 0 0 4px;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--text-2);
}

.socket {
  fill: none;
  stroke: var(--rel-commands, var(--accent));
  stroke-width: 1.5;
}

.edge.query {
  stroke: var(--rel-queries);
  opacity: 0.6;
}

.lead {
  margin: 6px 0 12px;
  font-size: 13px;
  color: var(--text-2);
}

.group {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 14px;
  align-items: center;
  padding: 10px 0;
  border-top: 1px solid var(--border);
}

.group h3 {
  margin: 0 0 2px;
  font-size: 13px;
}

.group p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-2);
}

svg {
  width: 120px;
  height: 64px;
}

.band {
  fill: var(--layer-bg);
  stroke: var(--layer-border);
}

.node {
  fill: var(--surface);
  stroke: var(--text-3);
}

.edge {
  fill: none;
  stroke: var(--rel-commands, var(--accent));
  stroke-width: 1.5;
}

.edge.now {
  stroke: var(--accent);
  stroke-width: 2.5;
}

.edge.ret {
  stroke-dasharray: 4 3;
}

.edge.dashed {
  stroke-dasharray: 5 3;
}

.edge.dotted {
  stroke: var(--text-3);
  stroke-dasharray: 1 3;
  stroke-linecap: round;
}

.edge.bad {
  stroke: var(--danger);
  stroke-dasharray: 1 3;
  stroke-linecap: round;
}

.head {
  fill: var(--rel-commands, var(--accent));
}

.life {
  stroke: var(--border);
  stroke-dasharray: 3 3;
}

.mark {
  font-size: 9px;
  fill: var(--warning);
}

.foot {
  margin: 10px 0 0;
  font-size: 12px;
}
</style>
