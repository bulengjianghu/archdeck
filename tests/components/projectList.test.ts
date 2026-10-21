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
})
