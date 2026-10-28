<script setup lang="ts">
/**
 * 模块面板的「拆分信号」一节（K21，ADR-0038）：模块拆分的最小单位是文件——不占文件、与兄弟共用文件、子模块之间有交互却没有值依赖、
 * 超长文件（G20），都是该先拆文件的信号。只在有代码事实时出现，没有信号时不出现。
 */
import { computed } from 'vue'
import { useDesk } from '@/state/inject'
import { moduleName } from '@/model'
import Section from './Section.vue'

const props = defineProps<{ id: string }>()
const desk = useDesk()
const s = computed(() => desk.facts.splitOf(props.id))
const total = computed(() => desk.files.linesOf(props.id))
const name = (id: string) => (desk.index.value ? moduleName(desk.index.value, id) : id)
const count = computed(() => {
  const x = s.value
  if (!x) return 0
  return (
    (x.noFiles ? 1 : 0) +
    x.shared.length +
    x.children.noFiles.length +
    x.children.shared.length +
    (x.noDeps ? 1 : 0) +
    (x.noDeps ? 0 : x.undepended.length) +
    (total.value.long ? 1 : 0)
  )
})
</script>

<template>
  <Section v-if="s && count" title="拆分信号" :count="count" data-testid="split-signals">
    <p class="muted">模块拆分的最小单位是文件：下面每一条都指向「先拆文件」（K21）。</p>
    <ul class="plain">
      <li v-if="s.noFiles">它不占任何文件：代码在别的模块的文件里，划分小于文件</li>
      <li v-for="x in s.shared" :key="x.file">
        与
        {{
          x.modules
            .filter(m => m !== id)
            .map(name)
            .join('、')
        }}
        共用文件
        <button class="link" @click="desk.selectFile(x.file)">{{ x.file }}</button>
      </li>
      <li v-if="s.children.noFiles.length">{{ s.children.noFiles.length }} 个子模块不占文件：{{ s.children.noFiles.map(name).join('、') }}</li>
      <li v-for="x in s.children.shared" :key="x.file">
        子模块 {{ x.modules.map(name).join('、') }} 共用文件
        <button class="link" @click="desk.selectFile(x.file)">{{ x.file }}</button>
      </li>
      <li v-if="s.noDeps">子模块之间有交互、没有值依赖：交互写在兄弟之间、依赖却在别处，或边界没沿文件切</li>
      <template v-else>
        <li v-for="x in s.undepended" :key="`${x.from}-${x.to}`">{{ name(x.from) }} 与 {{ name(x.to) }} 直接交互，两个方向都没有值依赖</li>
      </template>
      <li v-if="total.long">{{ total.long }} 个文件超过 {{ desk.files.maxLines.value }} 行（见「源代码文件」）</li>
    </ul>
  </Section>
</template>
