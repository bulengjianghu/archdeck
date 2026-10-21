/** 源码归属（docs/architecture/source.md §3） */
export * from './types'
export { matchRef, normalizeRef, staticPrefix, hasWildcard } from './glob'
export { assignFiles, moduleFiles, moduleDir, moduleEntry, moduleInterfaces, matchExports, fileNodes, sourceIssues, fileTree, isLong, moduleLines } from './ownership'
export { MODULE_EXTS, joinPath, indexFile, completePath, resolveRelative, packageEntry, packageName, specResolver } from './resolve'
export type { SpecResolver } from './resolve'
