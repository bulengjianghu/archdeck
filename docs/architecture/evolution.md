# 专题：演化事实（git 历史）

> 回答：被描述项目的 git 历史从哪里读；文件级的提交怎么提升为模块的修改热度、缺陷热度与时间耦合；画布与面板怎么叠加。
> 覆盖模块：接入层的「源码历史读取」；模型层的「演化事实」（归架构治理专题的同一条价值链：第三类事实）。规则见 [02-domain.md](../02-domain.md) 的 J；决策见 [ADR-0023](../adr/0023-sketch-reviewed-and-evolution.md)；界面见[工作台界面](./workbench.md) §4、§8–§10；归属复用[源码接入与归属](./source.md)，依赖与关系的对照复用[架构治理](./governance.md)。
> 状态：**已实现**。

## 1. 分工

```text
本地源码根目录（git 仓库）                          接入层：只读 git log，不判断归属
   │ readSourceHistory（J1，按 HEAD 与窗口缓存）
   ▼
SourceHistory { head, days, since, commits: HistoryCommit[] }
   │  开发服务器端点 source/<项目>/history.json；命令行与 agent 接口直接调用
   ▼
evolutionStats(index, own, history, lines, report?, opts)    模型层：纯函数
   ├ moduleHistory → ModuleHistory（J2、J3）
   ├ couplings → Coupling（J4，标注有无依赖 / 关系）
   ├ heatTiers · levelEvolution（J3 分档、本层投影）
   └ hotspots · isolatedCouplings（J8、J6）
   │
   ├─ DeskState：evolution.level → 画布角标与耦合线（J5）、面板
   ├─ 返工清单：类别「时间耦合」（J6）
   └─ agent 接口：arch hotspots · arch coupling
```

- 代码事实回答「代码现在依赖谁」，描述回答「设计上该依赖谁」；git 历史回答「实际上谁总是一起改、谁一直在修」。它不依赖 AI 判断，也不受静态分析限制，是第三类事实（ADR-0023）。
- 「哪个模块最热」「哪两个模块时间耦合」是关于被描述系统的知识，命令行、MCP 同样需要，所以统计在模型层（原则 6）；接入层只读 git。
- 只对当前版本（同 K8）；设计版本与提交版本没有演化事实。

## 2. 源码历史读取（接入层，`vite/readHistory.ts`）

| 函数 | 做什么 | 规则 |
|---|---|---|
| `historyOptions(system)` | 从 `system.source.history` 取窗口天数（缺省 180）、补充的缺陷匹配正则、耦合阈值 | J1、J4 |
| `readSourceHistory(root, files, opts)` | 在源码根目录执行 `git log --no-merges --numstat --no-renames --since=<窗口起点> --format=…`（参数经 `execFile`，不经 shell，`core.quotePath=false`）；每条提交记哈希、短哈希、日期、标题、是否缺陷修复、涉及的文件及增删行数（二进制为 0）；路径按 `git rev-parse --show-prefix` 换算为相对源码根目录，只保留源码清单中的文件，没有清单内文件的提交不记；按 `<根目录>|<HEAD>|<天数>|<起点日期>` 缓存；先查 `git rev-parse --is-shallow-repository`，为 true 时原因「浅克隆，历史不完整」；不在 git 仓库内、没有提交、浅克隆、git 不可用时返回 `{ status: 'error', reason }`，不抛异常；窗口内 0 提交时结果带 `note`（「近 N 天没有触及源码的提交」） | J1 |
| `isFixSubject(subject, extra)` | 标题匹配 `^(fix|hotfix|bugfix)\b`（不分大小写）或含「修复」，或命中项目补充的正则 | J1 |
| `readCommitMessage(root, hash)` | 一个提交的完整说明（`git show -s --format=%B`，提交号只收十六进制），面板展开时按需取 | — |

### 2.1 端点

| 端点 | 返回 |
|---|---|
| `GET source/<项目>/history.json` | `SourceHistory`：`ok`（HEAD、窗口、起点、提交列表）或 `error`（原因） |
| `GET source/<项目>/commit.json?hash=` | `{ hash, message }`；提交不存在为 404 |

## 3. 演化事实（模型层，`src/model/evolution/`）

| 函数 | 做什么 | 规则 |
|---|---|---|
| `moduleHistory(index, own, history)` | 每条提交的文件按归属取模块（未归属、已忽略、冲突文件不计），加上祖先链去重，得到每个模块触及的提交集；修改次数 = 提交数，缺陷次数 = 其中缺陷修复的提交数；记录模块是否有直接归属文件 | J2 |
| `heatOf(changes, lines)` | 次数 × √max(1, 行数)；行数为模块文件的行数合计（`moduleLines`，G21） | J3 |
| `heatTiers(values)` | 一组热度值的三档分位数：按值排序三等分，0 不分档；返回值 → 档位 | J3 |
| `couplings(index, stats, report?, opts)` | 每条提交触及的模块（含祖先）两两配对，去掉祖先与后代的对；同提交次数 ≥ `min`（缺省 5）且占两端各自修改次数 ≥ `ratio`（缺省 30%）的为时间耦合；标注两端子树之间有没有模块依赖（任一方向，K4）与描述关系（任一方向，类型不限） | J4 |
| `evolutionStats(index, own, history, lines, report?, opts)` | 组合以上：窗口、提交与缺陷数、每个模块的统计、耦合对 | J1–J4 |
| `levelEvolution(index, view, stats, kind)` | 本层投影：每个视图节点（模块、带、边界节点）按所选热度种类取值并在本层节点间分档；耦合对两端投影到本层两个不同节点的成为耦合线（同一对节点合并，次数为共同提交的并集、任一对有依赖或关系即算有） | J3、J4、J5 |
| `specificCouplings(index, couplings)` · `listedCouplings(stats)` | 最具体的耦合对：两端子树内已有更深的耦合对时祖先对不列（同一现象的并集）；面板、返工清单与命令行只列这些，本层投影用全部对 | J4 |
| `hotspots(stats, kind, limit)` | 热度前 N：只列有直接归属文件的模块，按热度降序、同值按修改次数再按 ID | J8 |
| `isolatedCouplings(stats)` | 无依赖且无描述关系的耦合对，按次数降序 | J6 |
| `coupleId(a, b)` · `coupleEnds(id)` | 耦合对的稳定键 `<A>~<B>`（按 ID 排序） | J7 |

### 3.1 数据结构

```ts
interface HistoryCommit { hash: string; short: string; date: string; subject: string; fix: boolean; files: { path: string; added: number; deleted: number }[] }
type SourceHistory =
  | { status: 'ok'; head: string; days: number; since: string; commits: HistoryCommit[]; note?: string }   // commits 新的在前；0 提交时带 note
  | { status: 'error'; reason: string }
interface HistoryOptions { days: number; fixPatterns: string[]; coupling: { min: number; ratio: number } }

interface ModuleHistory { id: string; direct: boolean; changes: number; fixes: number; lines: number; heat: number; fixHeat: number; commits: string[] }
interface Coupling { id: string; a: string; b: string; shared: number; ratioA: number; ratioB: number; dependency: boolean; relation: boolean; commits: string[] }
interface EvolutionStats { days: number; since: string; commits: number; fixes: number; modules: Map<string, ModuleHistory>; couplings: Coupling[]; specific: Set<string> /* 最具体的对的 ID */ }

type HeatKind = 'changes' | 'fixes'
type HeatTier = 1 | 2 | 3
interface LevelEvolution {
  kind: HeatKind
  heat: Map<string, { tier: HeatTier; value: number; count: number }>   // 视图节点 ID → 档位（0 不在其中）
  couplings: LevelCoupling[]
}
interface LevelCoupling { id: string /* `couple:<a>~<b>`，a、b 为节点 ID */; from: string; to: string; fromModule: string; toModule: string; shared: number; isolated: boolean; pairs: string[]; primary: string /* 单击选中的那一对 */ }
```

## 4. 页面

- `source/<项目>/history.json`：源码清单取到后随事实一起取（源码同步 `history`）；读不到时演化状态为 `error` 并带原因，「显示」面板的「演化」组置灰并写明原因。
- DeskState 的 `evolution` 分组：`stats = evolutionStats(…)`；`level = levelEvolution(…)`（只在结构 / 交互视角、热度或耦合任一开启时用于画布，J5）；`selectedCouple`：选中的耦合线（J7）；返工清单多一类「时间耦合」（J6）。「刷新源码」同时重新取历史。
- 开关 `toggles.heat`（`off` / `changes` / `fixes`）与 `toggles.coupling` 在视图状态里（与 `showFacts` 同），不进 URL；按项目记在本地（`display/useEvolutionPrefs.ts`），进入项目时恢复。
- 画布：`canvasScene` 多一个输入 `evolution`——节点数据多 `heat`（角标：档位、种类、值、次数），耦合线为不参与布局的波浪线（`temp: 'couple'`，标 `×N`，无依赖无关系的更深色）；单击耦合线即选中它（`sel=c:`）。
- 面板：模块「演化」（次数、热度、窗口、最近 10 次提交——可展开看提交说明与本模块涉及的文件、耦合对端）；系统「演化」（热度前 10、无依赖的耦合对）；关系与聚合边头部「同提交 ×N」；耦合线面板 `CouplePanel`（两端、次数与占比、有无依赖 / 关系、共同的提交）。
- 导航树「模块」页签：排序「描述顺序 / 按热度」（J8）。
- 命令行 `npm run arch -- hotspots [--fixes] [--limit N]`、`coupling [--isolated]`，MCP 同名工具，与页面同一函数。

## 5. 接口

```ts
// 接入层
historyOptions(system: SystemDef): HistoryOptions
readSourceHistory(root: string, files: readonly string[], opts: HistoryOptions & { now?: Date }): SourceHistory
readCommitMessage(root: string, hash: string): string | null

// 模型层
isFixSubject(subject: string, extra?: readonly string[]): boolean
evolutionStats(index: ModelIndex, own: SourceOwnership, history: Extract<SourceHistory, { status: 'ok' }>, lines: Record<string, number>, report?: GovernanceReport | null, opts?: Partial<HistoryOptions['coupling']>): EvolutionStats
heatTiers(values: readonly number[]): (value: number) => HeatTier | null
levelEvolution(index: ModelIndex, view: LevelView, stats: EvolutionStats, kind: HeatKind): LevelEvolution
hotspots(stats: EvolutionStats, kind: HeatKind, limit?: number): ModuleHistory[]
isolatedCouplings(stats: EvolutionStats): Coupling[]
```

## 6. 性能

h5player 近一年 1859 次提交：`git log --numstat` 一次约 1 秒，按 HEAD 缓存后 0；模块统计为 O(提交数 × 每次提交的模块数²)，几十毫秒。
