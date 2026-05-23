#!/bin/bash
# refresh-agent-worktree.sh
# Sync the per-agent worktree to origin/main at task-start time.
# Default: hard reset to origin/main. With --keep-branch <name>, stays on that
# feature branch (e.g. for Codex bot Nit-fix follow-ups).
#
# Usage:
#   refresh-agent-worktree.sh [--keep-branch <branch>] [<agent>]

set -uo pipefail

KEEP_BRANCH=""
AGENT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --keep-branch)
      KEEP_BRANCH="${2:-}"
      shift 2
      ;;
    --keep-branch=*)
      KEEP_BRANCH="${1#--keep-branch=}"
      shift
      ;;
    *)
      AGENT="$1"
      shift
      ;;
  esac
done

AGENT="${AGENT:-${CTX_AGENT_NAME:-}}"
if [ -z "$AGENT" ]; then
  echo "refresh-agent-worktree.sh: AGENT required (positional arg or CTX_AGENT_NAME env)" >&2
  exit 2
fi

CTX_ROOT_VAL="${CTX_ROOT:-$HOME/.cortextos/default}"
WORKTREE="${CTX_AGENT_WORKTREE:-$CTX_ROOT_VAL/state/agents/$AGENT/worktree}"

if [ ! -e "$WORKTREE/.git" ]; then
  echo "refresh-agent-worktree.sh: worktree not found at $WORKTREE (run init-agent-worktree.sh first)" >&2
  exit 1
fi

echo "refresh-agent-worktree.sh: fetching origin in $WORKTREE"
git -C "$WORKTREE" fetch origin

if [ -n "$KEEP_BRANCH" ]; then
  echo "refresh-agent-worktree.sh: keeping branch $KEEP_BRANCH (no reset)"
  git -C "$WORKTREE" checkout "$KEEP_BRANCH"
else
  echo "refresh-agent-worktree.sh: hard-reset to origin/main"
  git -C "$WORKTREE" checkout main
  git -C "$WORKTREE" reset --hard origin/main
fi
