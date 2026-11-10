/**
 * 挂载点的范围（X9、X18，ADR-0025）：一张草图只画一个层次——挂载点的直接子模块（根挂载为层与层的直接子模块）、
 * 显式写在本层的关系（两端都在本层，或一端在本层、另一端在挂载点子树之外）。底稿复制、核验与两个对比都按它取版本的同一范围。纯函数。
 */
import { ROOT_MOUNT, type ModelIndex } from '../types'

export interface MountScope {
  mount: string
  /** 本层模块（按版本里的顺序）；挂载点不在版本里时为空 */
  modules: string[]
  /** 本层模块 → 它的父模块（挂载点；根挂载时层为系统根、第二级为层） */
  parentOf: ReadonlyMap<string, string>
  /** 显式写在本层的关系 ID（按版本里的顺序） */
  relations: string[]
  /** 本层模块提供的接口 ID */
  interfaces: string[]
  /** id 在挂载点的子树内（根挂载：全部） */
  within: (id: string) => boolean
}

/** X9：模块在挂载点之下（含挂载点自身；根挂载时全部） */
export const underMount = (index: ModelIndex, mount: string, id: string): boolean =>
  mount === ROOT_MOUNT || id === mount || !!index.pathOf.get(id)?.includes(mount)

/** X9、X18：版本里挂载点的一层 */
export function mountScope(index: ModelIndex, mount: string): MountScope {
  const parentOf = new Map<string, string>()
  if (mount === ROOT_MOUNT) {
    for (const layer of index.childrenOf.get(index.rootId) ?? []) {
      parentOf.set(layer, index.rootId)
      for (const kid of index.childrenOf.get(layer) ?? []) parentOf.set(kid, layer)
    }
  } else if (index.modules.has(mount)) for (const kid of index.childrenOf.get(mount) ?? []) parentOf.set(kid, mount)
  const modules = [...parentOf.keys()]
  const within = (id: string) => underMount(index, mount, id)
  const local = (id: string) => parentOf.has(id)
  const relations = [...index.relations.values()]
    .filter(r => (local(r.from) && (local(r.to) || !within(r.to))) || (local(r.to) && !within(r.from)))
    .map(r => r.id)
  const interfaces = [...index.interfaces.values()].filter(x => x.owner && local(x.owner)).map(x => x.id)
  return { mount, modules, parentOf, relations, interfaces, within }
}

/** X9：ID 形如挂载点的直接子节点（`<mount>.<短名>`；根挂载为层 ID 或 `<层>.<短名>`）——判断「端点原在本层」用 */
export function looksLocal(mount: string, id: string, layers: ReadonlySet<string>): boolean {
  if (mount === ROOT_MOUNT) {
    if (layers.has(id)) return true
    const dot = id.indexOf('.')
    return dot > 0 && layers.has(id.slice(0, dot)) && !id.includes('.', dot + 1)
  }
  return id.startsWith(`${mount}.`) && !id.slice(mount.length + 1).includes('.')
}
