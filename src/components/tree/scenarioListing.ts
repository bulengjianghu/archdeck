/**
 * 场景列表的筛选结果（D-1、R4、R4a、R17）：列表、计数与发起者选项由同一份派生给出——侧栏场景页、画布「场景 ▾」下拉与「筛选 ▾」弹层共用。
 */
import { filterScenariosByKind, moduleName } from '@/model'
import type { DeskState } from '@/state/useDeskState'

export interface ScenarioFilterValues {
  scope: 'level' | 'all'
  kinds: 'main' | 'all'
  trigger: string
}

export function scenarioListing(desk: DeskState, f: ScenarioFilterValues) {
  const all = desk.run.catalog.value.map(({ scenario: s, trigger: by, messages }) => ({
    s,
    by,
    byName: by ? moduleName(desk.index.value!, by) : '—',
    count: messages,
  }))
  const related = new Set(desk.index.value?.scenariosOf.get(desk.levelId.value) ?? [])
  const triggers = [...new Map(all.filter(x => x.by).map(x => [x.by!, x.byName])).entries()]
  const inScope = all.filter(x => (f.scope === 'all' || related.has(x.s.id)) && (!f.trigger || x.by === f.trigger))
  const mainCount = filterScenariosByKind(
    inScope.map(x => x.s),
    'main',
  ).length
  const keep = new Set(
    filterScenariosByKind(
      inScope.map(x => x.s),
      f.kinds,
    ),
  )
  const shown = inScope.filter(x => keep.has(x.s))
  return { all, related, triggers, inScope, mainCount, shown }
}
