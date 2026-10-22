/** 关系类型迁移（M12、ADR-0022）：event → notifies 并翻转两端，dataflow → streams；只改这几个值，注释与排版原样保留 */
import { describe, expect, it } from 'vitest'
import { migrateText } from '../../vite/migrateRelations'

describe('M12 迁移旧名', () => {
  it('流式与块式写法都改；event 翻转 from / to；注释、引号、其他字段不动', () => {
    const text = [
      '# 关系',
      'relations:',
      "  - { id: a, from: sub, to: 'pub', type: event, mode: async } # 尾注释",
      '  - id: b',
      '    from: src',
      '    to: dst',
      '    type: dataflow',
      '    description: 帧',
      '  - { id: c, from: x, to: y, type: calls }',
      '',
    ].join('\n')
    const r = migrateText(text)!
    expect(r.text).toBe(
      [
        '# 关系',
        'relations:',
        "  - { id: a, from: 'pub', to: sub, type: notifies, mode: async } # 尾注释",
        '  - id: b',
        '    from: src',
        '    to: dst',
        '    type: streams',
        '    description: 帧',
        '  - { id: c, from: x, to: y, type: calls }',
        '',
      ].join('\n'),
    )
    expect([r.flipped, r.renamed]).toEqual([['a'], ['b']])
  })

  it('翻转的关系说明里有方向字样时列出供人工核对；没有旧名时返回 null', () => {
    const r = migrateText('relations:\n  - { id: a, from: s, to: p, type: event, description: 订阅 Foo }\n')!
    expect(r.review).toEqual([{ line: 2, id: 'a', description: '订阅 Foo' }])
    expect(migrateText('relations:\n  - { id: a, from: s, to: p, type: notifies }\n')).toBeNull()
  })
})
