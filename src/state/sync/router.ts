/**
 * 路由同步：地址始终是视图状态的投影（N6、N10）。
 * - 状态 → 地址：write(history) 把 encodeView 的结果按 push / replace 写入；
 * - 地址 → 状态：后退、前进、改地址 → onRestore(query)。
 *
 * 路由导航是异步的：自己发起的导航完成前，路由变化一律视为回声、不回写状态，
 * 否则双击（两次选中 + 一次下钻）时旧地址会覆盖新层次。离开本项目或本版本的路由时也不回写。
 */
import { watch, type WatchStopHandle } from 'vue'
import type { LocationQuery, Router } from 'vue-router'
import { isCommitVersion, isIntentVersion, type VersionRef } from '@/model'
import { sameQuery, type Query } from '../transition'

export interface RouterSyncOptions {
  /** 所属项目；给出时只响应该项目路由（/p/<project>）上的变化 */
  project?: string
  /** 所属版本；缺省为当前版本。只响应同一版本路由上的变化 */
  version?: VersionRef
}

export interface RouterSync {
  /** 当前地址的查询参数 */
  query(): Query
  /** 把状态写进地址；与当前地址相同时不导航 */
  write(next: Query, history: 'push' | 'replace'): void
  stop(): void
}

export function toQuery(q: LocationQuery): Query {
  const out: Query = {}
  for (const [k, v] of Object.entries(q)) if (typeof v === 'string') out[k] = v
  return out
}

export function createRouterSync(router: Router, options: RouterSyncOptions, onRestore: (query: Query) => void): RouterSync {
  let internalNav = 0

  const onOwnRoute = () => {
    const params = router.currentRoute.value.params
    if (options.project !== undefined && params.project !== options.project) return false
    const v = options.version
    const same = (key: string, want?: string) => (params[key] ?? undefined) === want
    if (isCommitVersion(v)) return same('commit', v.commit) && same('base', v.base)
    if (isIntentVersion(v)) return same('intent', v.intent)
    return same('design', v?.design) && same('revision', v?.revision) && same('commit', undefined) && same('intent', undefined)
  }

  const stop: WatchStopHandle = watch(
    () => router.currentRoute.value.query,
    q => {
      if (internalNav > 0 || !onOwnRoute()) return
      onRestore(toQuery(q))
    },
  )

  return {
    query: () => toQuery(router.currentRoute.value.query),
    write(next, history) {
      if (sameQuery(toQuery(router.currentRoute.value.query), next)) return
      internalNav++
      const query = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as Record<string, string>
      void (history === 'push' ? router.push({ query }) : router.replace({ query })).finally(() => internalNav--)
    },
    stop,
  }
}
