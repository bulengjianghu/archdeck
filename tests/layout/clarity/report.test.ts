import { it } from 'vitest'
import { KINDS } from './checker'
import { PROJECTS, checkProject } from './scenes'

it.skipIf(!process.env.CLARITY_REPORT)(
  'W 计数报告',
  async () => {
    const rows: string[] = []
    for (const p of PROJECTS) {
      const { levels, total } = await checkProject(p)
      rows.push(`${p}\t${KINDS.map(k => `${k}=${total[k]}`).join('\t')}`)
      const bare = await checkProject(p, { facts: false })
      rows.push(`${p}（无代码事实）\t${KINDS.map(k => `${k}=${bare.total[k]}`).join('\t')}`)
      const struct = await checkProject(p, { perspective: 'structure' })
      rows.push(`${p}（结构视角）\t${KINDS.map(k => `${k}=${struct.total[k]}`).join('\t')}`)
      if (process.env.CLARITY_REPORT === 'levels')
        for (const l of levels) if (KINDS.some(k => l.counts[k])) rows.push(`  ${l.level}\t${KINDS.map(k => `${k}=${l.counts[k]}`).join('\t')}`)
    }
    console.log(rows.join('\n'))
  },
  600000,
)

it.skipIf(!process.env.CLARITY_LEVEL)(
  'W 某层明细',
  async () => {
    const [p, level, perspective] = process.env.CLARITY_LEVEL!.split(':')
    const { checkLevel, loadProject } = await import('./scenes')
    const r = await checkLevel(loadProject(p), level, perspective === 'structure' ? 'structure' : 'interaction')
    for (const f of r!.findings) console.log(f.kind, f.ids.join('  '), Math.round(f.at.x), Math.round(f.at.y))
  },
  600000,
)
