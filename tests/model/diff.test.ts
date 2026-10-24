import { describe, expect, it } from 'vitest'
import { diffModels, loadModel } from '../../src/model'
import { sampleFiles } from '../fixtures/sample'

const base = loadModel(sampleFiles()).index

/** 在样例上做一份「设计」：新增模块与关系、改职责、删关系、改接口签名 */
function designed() {
  const files = sampleFiles().map(f => {
    if (f.path === 'relations.yaml')
      return {
        ...f,
        text: f.text
          .replace("  - { id: r7, from: infra.mus, to: domain.models, type: implements }\n", '')
          .replace("signature: 'sendCommand(cmd: Command): Result'", "signature: 'sendCommand(cmd: Command, opts?: Opts): Result'"),
      }
    if (f.path === 'modules/infra.yaml')
      return {
        ...f,
        text: f.text
          .replace('responsibility: 流水线 }', 'responsibility: 流水线（含回放钩子）, designNote: 为二期回放留钩子 }')
          .replace(
            '        - { id: infra.framework.pipeline,',
            '        - { id: infra.framework.tracer, name: Tracer, responsibility: 记录步骤 }\n        - { id: infra.framework.pipeline,',
          ),
      }
    return f
  })
  files.push({ path: 'extra.yaml', text: 'relations:\n  - { id: r8, from: infra.framework.tracer, to: domain.models, type: streams }\n' })
  return loadModel(files).index
}

describe('模型层 · 版本对比 diffModels', () => {
  it('同一份模型没有变更', () => {
    const d = diffModels(base, loadModel(sampleFiles()).index)
    expect(d.changes).toEqual([])
    expect(d.counts).toEqual({ added: 0, changed: 0, removed: 0, merged: 0, split: 0, renamed: 0, moved: 0 })
  })

  it('按实体对齐，区分新增 / 修改 / 删除，并给出修改的字段', () => {
    const d = diffModels(base, designed())
    const brief = d.changes.map(c => `${c.entity}:${c.kind}:${c.id}`)
    expect(brief).toEqual([
      'module:added:infra.framework.tracer',
      'module:changed:infra.framework.pipeline',
      'relation:added:r8',
      'relation:removed:r7',
      'interface:changed:if.sm',
    ])
    expect(d.module.get('infra.framework.pipeline')?.fields).toEqual(['responsibility']) // designNote 不算修改
    expect(d.interface.get('if.sm')?.fields).toEqual(['signature'])
    expect(d.relation.has('r7')).toBe(false) // 删除项只出现在 changes 里
    expect(d.counts).toEqual({ added: 2, changed: 2, removed: 1, merged: 0, split: 0, renamed: 0, moved: 0 })
  })

  it('关系的显示名是「起点 → 终点」，删除项取基线中的名字', () => {
    const d = diffModels(base, designed())
    expect(d.changes.find(c => c.id === 'r7')?.name).toBe('MUs → Models')
  })

  it('touched：上级模块累计其子树与相关关系的变更，引导下钻', () => {
    const d = diffModels(base, designed())
    // framework 子树：tracer 新增、pipeline 修改、r8（tracer 为起点）新增、if.sm（sm 提供）修改
    expect(d.touched.get('infra.framework')).toBe(4)
    // infra 层还多了 r7 的删除（MUs 为端点）
    expect(d.touched.get('infra')).toBe(5)
    // 模块自身的增改不计入自己，但关系端点计入
    expect(d.touched.get('infra.framework.tracer')).toBe(1)
    expect(d.touched.get(base.rootId)).toBe(5)
  })

  it('缺省与空数组视为相同', () => {
    const files = sampleFiles({ 'x.yaml': 'modules: [{ id: z, name: Z, tags: [] }]' })
    const d = diffModels(loadModel(sampleFiles({ 'x.yaml': 'modules: [{ id: z, name: Z }]' })).index, loadModel(files).index)
    expect(d.changes).toEqual([])
  })
})
