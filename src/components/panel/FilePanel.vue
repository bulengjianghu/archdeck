<script setup lang="ts">
/**
 * 文件面板（SR-7；G11 五段骨架，ADR-0050、V15）：① 头部（路径、行数与是否超长（G21）、归属徽标）
 * ④ 边界：归属模块（冲突时全部列出）或未归属 / 已忽略、当前层次中的投影（G14）、作为哪些模块的入口
 * ⑤ 证据与细节：源码异常态（读不到 / 文件不存在）、入口导出（ExportSection 折叠带计数）。
 * 未归属文件可「加入忽略」：只追加 source-ignore.yaml（人拥有的文件，B4、ADR-0019）；属于某个模块时仍由人或 AI 补 codeRefs。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { isLong, moduleName } from '@/model'
import { useOpenPreview } from '../shared/preview'
import Section from './Section.vue'
import ExportSection from './ExportSection.vue'
import WriteForm from './WriteForm.vue'

const props = defineProps<{ path: string }>()
const desk = useDesk()
const openPreview = useOpenPreview()
const idx = computed(() => desk.index.value!)
const local = computed(() => (desk.files.payload.value?.status === 'local' ? desk.files.payload.value : null))
const exists = computed(() => !!local.value?.files.includes(props.path))
const owners = computed(() => desk.files.ownership.value?.owners.get(props.path) ?? [])
const ignored = computed(() => !!desk.files.ownership.value?.ignored.has(props.path))
const hits = computed(() => desk.files.hits.value)
const entries = computed(() => desk.files.entryModulesOf(props.path))
const script = computed(() => /\.(m|c)?(t|j)sx?$/i.test(props.path))
const name = computed(() => props.path.split('/').pop())
const dir = computed(() => props.path.split('/').slice(0, -1).join('/'))
const lineCount = computed(() => desk.files.lines.value[props.path])
const long = computed(() => isLong(lineCount.value, desk.files.maxLines.value))
const levelName = computed(() => moduleName(idx.value, desk.levelId.value))
const pathOf = (id: string) =>
  (idx.value.pathOf.get(id) ?? [])
    .slice(1)
    .map(m => moduleName(idx.value, m))
    .join(' / ')
</script>

<template>
  <div class="file-panel">
    <header class="head" data-sec="head">
      <div class="title">
        <h2>{{ name }}</h2>
        <button v-if="exists" class="small" @click="openPreview(path)">预览源码</button>
      </div>
      <div class="badges">
        <code>{{ path }}</code>
        <span class="badge">文件</span>
        <span v-if="owners.length > 1" class="badge warn">归属冲突</span>
        <span v-else-if="exists && !owners.length && !ignored" class="badge warn">未归属</span>
        <span v-if="ignored" class="badge">已忽略</span>
        <span v-if="lineCount !== undefined" class="badge" :class="{ bad: long }"
          >{{ lineCount }} 行{{ long ? `（超过 ${desk.files.maxLines.value}）` : '' }}</span
        >
      </div>
    </header>

    <!-- ④ 边界：归属模块 → 当前层次 → 作为入口 -->
    <template v-if="local && exists">
      <Section title="归属模块" :count="owners.length" data-sec="boundary.owner">
        <ul v-if="owners.length" class="plain">
          <li v-for="o in owners" :key="o" class="owner">
            <button class="link" @click="desk.revealModule(o)">{{ moduleName(idx, o) }}</button>
            <span class="muted"> · {{ pathOf(o) }}</span>
          </li>
        </ul>
        <p v-if="owners.length > 1" class="warn-text">多个互不包含的模块的 codeRefs 都匹配这个文件，请只保留一处（G6）。</p>
        <p v-else-if="ignored" class="muted">在忽略清单（sourceIgnore）中，不属于任何模块。</p>
        <p v-else-if="!owners.length" class="warn-text">
          没有模块的 codeRefs 匹配这个文件：属于某个模块就补进它的 codeRefs，否则写进 <code>source-ignore.yaml</code> 的 sourceIgnore。
        </p>
        <WriteForm
          v-if="exists && !owners.length && !ignored && desk.write.canEditRules"
          label="加入忽略"
          :initial="path"
          placeholder="glob，相对源码根目录"
          :presets="
            dir
              ? [
                  { label: '这个文件', value: path },
                  { label: `整个目录 ${dir}/*`, value: `${dir}/*` },
                ]
              : []
          "
          :submit="p => desk.write.ignore(p)"
        />
      </Section>

      <Section v-if="owners.length" title="当前层次" data-sec="boundary.level">
        <p v-if="hits?.self" class="muted">属于当前层次本身（{{ levelName }}），下钻后可看到具体模块。</p>
        <p v-else-if="hits?.nodes.size" class="muted">已在画布上高亮 {{ hits.nodes.size }} 个节点。</p>
        <p v-else class="muted">在当前层次（{{ levelName }}）不可见；单击上面的归属模块可跳到它所在的层次。</p>
      </Section>

      <Section v-if="entries.length" title="作为入口" data-sec="boundary.entries">
        <ul class="plain">
          <li v-for="m in entries" :key="m">
            <button class="link" @click="desk.revealModule(m)">{{ moduleName(idx, m) }}</button> 的对外入口
          </li>
        </ul>
      </Section>

      <!-- ⑤ 证据与细节：源码异常态、入口导出（折叠带计数） -->
      <ExportSection v-if="script" :key="path" :file="path" :module-id="entries[0]" fold />
    </template>
    <template v-else>
      <Section title="源码" data-sec="evidence.source">
        <p v-if="!local" class="muted">
          {{ desk.files.payload.value?.status === 'error' ? desk.files.payload.value.reason : '正在读取源码清单…' }}
        </p>
        <p v-else class="muted">文件不存在：不在源码文件清单中（可能已删除或改名）</p>
      </Section>
    </template>
  </div>
</template>

<style scoped>
.owner {
  padding: 2px 0;
}

.warn-text {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--warning);
}
</style>
