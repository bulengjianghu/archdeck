/** 源码归属（docs/architecture/source.md §3） */
export * from './types'
export { matchRef, normalizeRef, staticPrefix, hasWildcard } from './glob'
export { assignFiles, moduleFiles, moduleDir, moduleEntry, moduleInterfaces, matchExports, fileNodes, sourceIssues, missingEvidence, fileTree, moduleLines } from './ownership'
export { MODULE_EXTS, joinPath, indexFile, completePath, resolveRelative, packageEntry, packageName, specResolver } from './resolve'
export type { SpecResolver } from './resolve'
export { DEFAULT_ADR_DIR, adrDir, adrLabel, adrFile, moduleAdrs, ancestorAdrs, adrIssues } from './adr'
export type { AdrLink } from './adr'
