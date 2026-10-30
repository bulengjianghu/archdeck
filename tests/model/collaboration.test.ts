/** PC-4：模块的协作——跨子树边界的关系按（方向，对端）合并，对端为画布上相邻的那一级；PC-10：经过关系的场景 */
import { describe, expect, it } from 'vitest'
import { collaborationsOf, loadModel, relationScenarios } from '../../src/model'
import { sampleFiles, scenarioFiles } from '../fixtures/sample'

const { index } = loadModel(sampleFiles())

describe('PC-4 协作的合并', () => {
  it('子树内部的关系不列；同一对端的多条合成一行（infra → app 两条）；对端取最近共同祖先之下的那一级', () => {
    const rows = collaborationsOf(index, 'infra')
    expect(rows).toEqual([
      { dir: 'out', peer: 'app', relations: ['r1', 'r3'] },
      { dir: 'out', peer: 'domain', relations: ['r7'] },
    ])
  })

  it('对端是兄弟时取兄弟本身（infra.framework → infra.mus），远处的取祖先一级（→ app）；入在前、出在后', () => {
    expect(collaborationsOf(index, 'infra.framework')).toEqual([
      { dir: 'out', peer: 'app', relations: ['r1'] },
      { dir: 'out', peer: 'infra.mus', relations: ['r4'] },
    ])
    const app = collaborationsOf(index, 'app.solution')
    expect(app.map(c => `${c.dir}:${c.peer}`)).toEqual(['in:infra', 'out:domain'])
    expect(app[0].relations).toEqual(['r1', 'r3'])
  })

  it('不存在的模块没有协作', () => {
    expect(collaborationsOf(index, 'nope')).toEqual([])
  })
})

describe('PC-10 经过关系的场景', () => {
  it('有消息步骤绑定到这条关系（显式写 relation 或按两端推出）的场景；没有的为空', () => {
    const { index: sc } = loadModel(scenarioFiles())
    expect(relationScenarios(sc, 'r6')).toContain('sc.play')
    expect(relationScenarios(sc, 'r7')).toEqual([])
    expect(relationScenarios(sc, 'nope')).toEqual([])
  })
})
