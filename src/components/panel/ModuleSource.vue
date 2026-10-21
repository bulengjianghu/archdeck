<script setup lang="ts">
/** 模块面板的「源代码」一节（SR-5）：模块的文件（子树并集，G4，带行数、超长标红，并给合计，G21）、入口文件（G10）、入口导出与 provides 的对应（G12） */
import { computed, ref } from 'vue'
import { useDesk } from '@/state/inject'
import { isLong, moduleLines, moduleName } from '@/model'
import Section from './Section.vue'
import ExportSection from './ExportSection.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const LIMIT = 30
const showAll = ref(false)
const local = computed(() => desk.files.payload.value?.status === 'local')
const files = computed(() => desk.files.filesOf(props.id))
const shown = computed(() => (showAll.value ? files.value : files.value.slice(0, LIMIT)))
const entry = computed(() => desk.files.entryOf(props.id))
const total = computed(() => moduleLines(files.value, desk.files.lines.value, desk.files.maxLines.value))
const long = (f: string) => isLong(desk.files.lines.value[f], desk.files.maxLines.value)
const VIA = { entry: '描述指定', index: '约定 index.ts', package: 'package.json' } as const
/** 文件直接归属的模块不是本模块时注明（子模块的文件） */
const ownerNote = (f: string) => {
  const os = desk.files.ownership.value?.owners.get(f) ?? []
  return os.length === 1 && os[0] === props.id ? '' : os.map(o => moduleName(desk.index.value!, o)).join('、')
}
const conflict = (f: string) => desk.files.ownership.value?.conflicts.includes(f)
</script>

<template>
  <Section title="源代码文件" :count="local ? files.length : undefined">
    <p v-if="!desk.files.payload.value" class="muted">正在读取源码清单…</p>
    <p v-else-if="desk.files.payload.value.status === 'absent'" class="muted">源码不在本地（{{ desk.files.payload.value.tried ?? desk.files.payload.value.reason }}）</p>
    <p v-else-if="desk.files.payload.value.status === 'unavailable'" class="muted">构建产物不含源码，请用 <code>npm run dev</code> 查看</p>
    <template v-else>
      <p v-if="!files.length" class="muted">没有文件归属这个模块{{ desk.index.value?.modules.get(id)?.codeRefs?.length ? '（codeRefs 没有匹配到文件）' : '（未写 codeRefs）' }}</p>
      <p v-if="total.counted" class="total muted">
        共 {{ total.lines }} 行<span v-if="total.long" class="bad"> · {{ total.long }} 个文件超过 {{ desk.files.maxLines.value }} 行</span>
      </p>
      <ul v-if="files.length" class="plain files">
        <li v-for="f in shown" :key="f">
          <button class="link" :title="f" @click="desk.selectFile(f)">{{ f }}</button>
          <span v-if="desk.files.lines.value[f] !== undefined" class="lines" :class="{ bad: long(f) }"> {{ desk.files.lines.value[f] }} 行</span>
          <span v-if="conflict(f)" class="badge warn">归属冲突</span>
          <span v-if="ownerNote(f)" class="muted"> · {{ ownerNote(f) }}</span>
        </li>
      </ul>
      <button v-if="files.length > LIMIT && !showAll" class="small" @click="showAll = true">显示全部 {{ files.length }} 个</button>
    </template>
  </Section>
  <Section v-if="local" title="入口文件">
    <p v-if="!entry" class="muted">没有对外入口（无 entry、模块目录下无 index.ts 或包入口）</p>
    <div v-else>
      <button class="link" @click="desk.selectFile(entry.file)">{{ entry.file }}</button>
      <span class="muted"> · {{ VIA[entry.via] }}</span>
      <span v-if="entry.missing" class="badge warn">文件不存在</span>
    </div>
  </Section>
  <ExportSection v-if="local && entry && !entry.missing" :key="entry.file" :file="entry.file" :module-id="id" />
</template>

<style scoped>
.total {
  margin: 0 0 4px;
  font-size: 12px;
}

.lines {
  font-size: 11.5px;
  color: var(--text-3);
}

.bad {
  color: var(--danger);
  font-weight: 600;
}

.files li {
  padding: 1px 0;
  font-size: 12.5px;
  word-break: break-all;
}
</style>
