#!/usr/bin/env bash
# 把上游 h5player-demo 里 packages/h5p-arch-desk 的新提交迁入本仓库，保留提交记录。
#
# 用法（在本仓库任意目录）：
#   docs/archdeck/sync-from-h5player-demo.sh [上游分支]           # 缺省 gix-next/model
#   docs/archdeck/sync-from-h5player-demo.sh --align [上游分支]   # 手工解决冲突并提交合并后，补做描述对齐
# 环境变量：H5P_DEMO_DIR 上游检出目录，缺省 ~/Documents/work4/h5player-demo
#
# git subtree split 对同一个上游提交总是得到同一个改写后的提交，所以每次重跑只追加新提交，可以反复增量合并。
# 前提：已迁入的上游提交不能再被 rebase / squash 改写，否则改写后的历史会与已迁入的分叉。
set -euo pipefail

SRC_DIR="${H5P_DEMO_DIR:-$HOME/Documents/work4/h5player-demo}"
PREFIX=packages/h5p-arch-desk
SPLIT_REF=refs/archdeck/split
SELF_SYSTEM=model/h5p-arch-desk/system.yaml

align_only=false
if [ "${1:-}" = "--align" ]; then
  align_only=true
  shift
fi
SRC_BRANCH="${1:-gix-next/model}"

cd "$(git rev-parse --show-toplevel)"
die() {
  echo "✗ $*" >&2
  exit 1
}

# 自项目描述：source.repo 保持 archdeck（G22 下源码根即本仓库）。上游的描述与代码一致——其 source.commit 之后包内只改过 model/（各项目的描述，不是代码）——时，
# source.commit 对齐到当前提交、generatedAt 记今天，「描述落后」胶囊归零；上游未对齐时保留上游的值，页面与 lint:model 照实报不一致
align() {
  local up_commit lag head note
  up_commit=$(git -C "$SRC_DIR" show "$SRC_BRANCH:$PREFIX/$SELF_SYSTEM" | sed -nE 's/^    commit: *//p') || true
  lag=$(git -C "$SRC_DIR" rev-list --count "$up_commit..$SRC_BRANCH" -- "$PREFIX" ":(exclude)$PREFIX/model" 2>/dev/null || echo '?')
  perl -pi -e 's/^(    repo: ).*/${1}archdeck/' "$SELF_SYSTEM"
  if [ "$lag" = 0 ]; then
    head=$(git rev-parse HEAD)
    perl -pi -e "s/^(    commit: ).*/\${1}$head/; s/^(    generatedAt: ).*/\${1}'$(date +%F)'/" "$SELF_SYSTEM"
    note="描述 source.commit 对齐 ${head:0:8}（同步上游后；之后只改描述，「描述落后」胶囊归零）"
  else
    echo "! 上游的描述没有对齐代码（source.commit ${up_commit:0:8} 之后包内有 $lag 个提交改了 model/ 之外的文件），source.commit 保留上游的值" >&2
    note="描述 source.repo 保持 archdeck（上游描述未对齐代码，source.commit 保留上游的值）"
  fi
  if git diff --quiet -- "$SELF_SYSTEM"; then
    echo "✓ 描述无需改动"
    return
  fi
  git add "$SELF_SYSTEM"
  git commit -q -m "docs(archdeck): $note"
  echo "✓ $(git log -1 --format='%h %s')"
}

[ -e "$SRC_DIR/.git" ] || die "找不到上游检出：${SRC_DIR}（用 H5P_DEMO_DIR 指定）"
git -C "$SRC_DIR" rev-parse -q --verify "$SRC_BRANCH^{commit}" >/dev/null || die "上游没有分支 ${SRC_BRANCH}"

if $align_only; then
  align
  exit 0
fi

[ -z "$(git status --porcelain)" ] || die "工作区不干净，先提交或还原"

echo "→ 抽取 ${SRC_DIR} @ ${SRC_BRANCH} 的 ${PREFIX}（约 1 分钟）"
split=$(git -C "$SRC_DIR" subtree split -P "$PREFIX" "$SRC_BRANCH" 2>/dev/null | tail -n1) || true
[[ "$split" =~ ^[0-9a-f]{40}$ ]] || die "subtree split 失败"
git -C "$SRC_DIR" update-ref "$SPLIT_REF" "$split"
git fetch -q "$SRC_DIR" "+$SPLIT_REF:refs/heads/archdesk-src"

if git merge-base --is-ancestor "$split" HEAD; then
  echo "✓ 已是最新（${split:0:8} 已在 $(git branch --show-current) 中）"
  exit 0
fi
echo "→ 迁入 $(git rev-list --count HEAD..archdesk-src) 个提交"

msg="merge: 同步上游 h5p-arch-desk（h5player-demo $SRC_BRANCH @ $(git -C "$SRC_DIR" rev-parse --short "$SRC_BRANCH")）"
if ! git merge -q --no-ff -m "$msg" archdesk-src; then
  conflicted=$(git diff --name-only --diff-filter=U)
  if [ "$conflicted" != "$SELF_SYSTEM" ]; then
    echo "✗ 合并冲突需要人工处理：" >&2
    echo "$conflicted" | sed 's/^/    /' >&2
    cat >&2 <<EOF
  约定：路径适配类改动（README、CLAUDE.md §4、docs/01 位置、docs/04 §3.7、$SELF_SYSTEM 的 source.repo）以本仓库为准，其余以上游为准。
  解决后 git commit，再运行：$0 --align $SRC_BRANCH
EOF
    exit 1
  fi
  # 唯一预期的冲突：上游改了 source.commit / generatedAt，与本地的 repo: archdeck 相邻。取上游内容，repo 改回 archdeck
  git checkout -q --theirs -- "$SELF_SYSTEM"
  perl -pi -e 's/^(    repo: ).*/${1}archdeck/' "$SELF_SYSTEM"
  git add "$SELF_SYSTEM"
  git commit -q --no-edit
fi
echo "✓ 已合并：$(git log -1 --format='%h %s')"
align

cat <<EOF
下一步：按 CLAUDE.md §4 跑门禁
  export ARCH_WORKSPACE_ROOT=<work4 的绝对路径>
  npm ci && npm run test && npm run type-check && npm run lint && npm run lint:model -- model/h5p-arch-desk && npm run build
  E2E_PORT=<空闲端口> npx playwright test --workers=4
EOF
