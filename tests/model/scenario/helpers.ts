/** 场景投影单测的共用 fixture：样例场景 sc.play 的回放计划、分支选择与舞台投影 */
import {
  loadModel,
  planScenario,
  projectLevel,
  projectScenario,
  resolvePath,
  stageEnds,
  type ModelIndex,
  type ScenarioPlan,
} from '../../../src/model'
import { scenarioFiles } from '../../fixtures/sample'

export const { index } = loadModel(scenarioFiles())
export const plan = planScenario(index, 'sc.play')
export const ALT = 'sc.play#3'
export const take = (c: number) => new Map([[ALT, c]])
export const ids = (p: ScenarioPlan, choices: Map<string, number>) => resolvePath(p, choices).frames.map(f => f.id)

export const stage = (idx: ModelIndex, level: string, p: ScenarioPlan) =>
  projectLevel(idx, level, { showBoundaries: true, scenarioEnds: stageEnds(p) })
export const project = (level: string, choices = take(0), p = plan, idx = index) => projectScenario(idx, stage(idx, level, p), p, choices)
