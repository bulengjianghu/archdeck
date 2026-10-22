// @vitest-environment jsdom
/** 项目列表（H-1、DV-6）：卡片只列推进中的设计版本，已归档的只注明个数 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ProjectList from '../../src/components/ProjectList.vue'
import { isArchived, type DesignStatus } from '../../src/model'

const design = (id: string, status: DesignStatus) => ({ id, name: id, status, revisions: [{ id: 'r1' }], problems: [] })
const project = {
  id: 'p',
  name: 'P',
  description: '',
  layered: false,
  top: [],
  counts: { modules: 1, relations: 0, interfaces: 0, dataStructures: 0, scenarios: 0 },
  errors: 0,
  warnings: 0,
  designs: [
    design('d-draft', 'draft'),
    design('d-review', 'reviewing'),
    design('d-accepted', 'accepted'),
    design('d-done', 'implemented'),
    design('d-drop', 'abandoned'),
  ],
}

afterEach(() => vi.unstubAllGlobals())

describe('项目列表', () => {
  it('DV-6：已实现、已放弃的设计归档', () => {
    expect((['draft', 'reviewing', 'accepted', 'implemented', 'abandoned'] as const).filter(isArchived)).toEqual(['implemented', 'abandoned'])
  })

  it('DV-6：卡片只列推进中的设计，已归档的只注明个数', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => [project] }))
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)', component: { render: () => null } }] })
    const wrapper = mount(ProjectList, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.findAll('.dname').map(n => n.text())).toEqual(['d-draft', 'd-review', 'd-accepted'])
    expect(wrapper.find('.archived').text()).toContain('已归档 2 个设计')
  })

  it('H-1：卡片以健康度为主——违规有基线时显示 ±N（绝对数进悬停），无基线时为绝对数并标「无基线」；规模为次', async () => {
    const health = (delta: number | null) => ({
      unowned: 2,
      conflicts: 1,
      violations: { count: 5, new: 1, resolved: 3, allowed: 0, delta },
      cycles: { count: 2, maxSize: 7, cyclicity: 53, baseline: 60 },
      unconfirmed: 4,
    })
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => [
        { ...project, id: 'a', designs: [], health: health(-2) },
        { ...project, id: 'b', designs: [], health: health(null) },
      ],
    }))
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)', component: { render: () => null } }] })
    const wrapper = mount(ProjectList, { global: { plugins: [router] } })
    await flushPromises()
    const [a, b] = wrapper.findAll('.card')
    expect(a.find('.violations dd').text()).toBe('−2')
    expect(a.find('.violations').attributes('title')).toContain('计入门禁 5 条')
    expect(a.find('.violations').classes()).toContain('bad')
    expect(a.find('.cycles dd').text()).toContain('2 · 最大 7')
    expect(a.find('.cycles dd').text()).toContain('↓')
    expect(b.find('.violations dt').text()).toContain('无基线')
    expect(b.find('.violations dd').text()).toBe('5')
    expect(a.find('.scale').text()).toContain('模块 1')
  })
})
