/**
 * 主语条的一行（LY-7）：所在路径（灰）› 名称 + ID + 角色徽标。主语由视图状态派生（subjectOf），这里只把它翻成显示用的文字，
 * 纯函数、不读状态。
 */
import { moduleName, stratumByKey, type ModelIndex } from '@/model'
import type { Subject } from '@/state/useDeskState'

export interface SubjectLabel {
  /** 所在路径（祖先，不含根与自己），灰字 */
  path: string[]
  name: string
  /** 等宽的 ID（或步骤位置） */
  id: string
  /** 角色 / 类别徽标 */
  badge?: string
}

const short = (p: string) => p.split('/').pop() ?? p

/** 祖先链（不含根与自己），至多最后两级 */
function pathOf(idx: ModelIndex, id: string): string[] {
  const chain = idx.pathOf.get(id) ?? []
  return chain
    .filter(x => x !== idx.rootId && x !== id)
    .slice(-2)
    .map(x => moduleName(idx, x))
}

export interface StepInfo {
  scenario: string
  label: string
  /** 第 i / N 步 */
  position: string
}

export function subjectLabel(idx: ModelIndex, s: Subject, step?: StepInfo | null): SubjectLabel {
  const name = (id: string) => moduleName(idx, id)
  switch (s.kind) {
    case 'system':
      return { path: [], name: idx.model.system.name, id: idx.rootId, badge: '系统' }
    case 'module': {
      const m = idx.modules.get(s.id)
      const layer = (idx.stratumOf.get(s.id)?.members.length ?? 0) === 1
      const badge = layer ? '层' : m?.role === 'core' ? '核心' : m?.role === 'shared' ? '共用' : (m?.kind ?? undefined)
      return { path: pathOf(idx, s.id), name: name(s.id), id: s.id, ...(badge ? { badge } : {}) }
    }
    case 'relation': {
      const r = idx.relations.get(s.id)
      return { path: [], name: r ? `${name(r.from)} → ${name(r.to)}` : s.id, id: s.id, badge: '关系' }
    }
    case 'edge':
      return { path: [], name: '交互边', id: s.id, badge: '边' }
    case 'actor':
      return { path: [], name: idx.actors.get(s.id)?.name ?? s.id, id: s.id, badge: '参与者' }
    case 'file':
      return { path: s.id.split('/').slice(-3, -1), name: short(s.id), id: s.id, badge: '文件' }
    case 'dep': {
      const [a, b] = s.id.split('->')
      return { path: [], name: `${name(a)} → ${name(b)}`, id: s.id, badge: '代码依赖' }
    }
    case 'couple': {
      const [a, b] = s.id.split('~')
      return { path: [], name: `${name(a)} ~ ${name(b)}`, id: s.id, badge: '时间耦合' }
    }
    case 'port':
      return { path: [], name: idx.interfaces.get(s.id)?.name ?? s.id, id: s.id, badge: '端口' }
    case 'cycle':
      return { path: [], name: `环 ${s.id}`, id: s.id, badge: '环' }
    case 'stratum':
      return { path: [], name: stratumByKey(idx, s.id)?.name ?? s.id, id: s.id, badge: '层' }
    case 'scenario':
      return { path: [], name: idx.scenarios.get(s.id)?.name ?? s.id, id: s.id, badge: '场景' }
    case 'step':
      return step ? { path: [step.scenario], name: step.label, id: step.position, badge: '步骤' } : { path: [], name: s.id, id: s.id, badge: '步骤' }
  }
}
