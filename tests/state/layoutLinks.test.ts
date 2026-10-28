import { describe, expect, it } from 'vitest'
import { portPanel, projectLevel, structureView } from '../../src/model'
import { loadProject } from '../layout/clarity/scenes'
import { baseLayoutLinks, portMarkedNodes } from '../../src/state/desk/layoutLinks'

describe('L11、L13（ADR-0039 修订 1）：有端口记号的节点交给布局', () => {
  const { index, report } = loadProject('h5player')

  it('普通层次只给声明了算端口的接口的子模块；分层总览不给', () => {
    const v = projectLevel(index, 'infra.framework')
    const marked = portMarkedNodes(index, v, report)
    expect(marked).toContain('infra.framework.contracts')
    const inner = v.nodes.filter(n => n.role === 'module' || n.role === 'core')
    expect(marked.length).toBeLessThan(inner.length)
    for (const n of inner) expect(marked.includes(n.id)).toBe(portPanel(index, report, n.moduleId).some(p => p.isPort))
    expect(portMarkedNodes(index, projectLevel(index, index.rootId), report)).toEqual([])
  })

  it('并集布局的输入带上它（有无代码事实都给）', () => {
    const v = projectLevel(index, 'infra.framework')
    expect(baseLayoutLinks(index, v, structureView(index, v, report), report, null).marked).toEqual(portMarkedNodes(index, v, report))
    expect(baseLayoutLinks(index, v, structureView(index, v, null), null, null).marked).toEqual(portMarkedNodes(index, v, null))
  })
})
