#!/bin/bash
# init-agent-worktree.sh
# Idempotent: create the per-agent git worktree if it doesn't exist yet.
# Part of worktree-isolation pattern
# (orgs/ascendops/docs/durable/worktree-isolation-design-2026-05-23.md).
#
# Usage:
#   init-agent-worktree.sh [<agent>]
#
# Defaults agent to $CTX_AGENT_NAME. Resolves worktree path from
# $CTX_AGENT_WORKTREE or computes $CTX_ROOT/state/agents/$agent/worktree.
# Framework root is $CTX_FRAMEWORK_ROOT.
#
# Exits 0 if worktree exists or was created. Exits non-zero on failure.

set -uo pipefail

AGENT="${1:-${CTX_AGENT_NAME:-}}"
if [ -z "$AGENT" ]; then
  echo "init-agent-worktree.sh: AGENT required (positional arg or CTX_AGENT_NAME env)" >&2
  exit 2
fi

FRAMEWORK_ROOT="${CTX_FRAMEWORK_ROOT:-}"
if [ -z "$FRAMEWORK_ROOT" ] || [ ! -d "$FRAMEWORK_ROOT/.git" ]; then
  echo "init-agent-worktree.sh: CTX_FRAMEWORK_ROOT must be a git repo (got '$FRAMEWORK_ROOT')" >&2
  exit 2
fi

CTX_ROOT_VAL="${CTX_ROOT:-$HOME/.cortextos/default}"
WORKTREE="${CTX_AGENT_WORKTREE:-$CTX_ROOT_VAL/state/agents/$AGENT/worktree}"

# Idempotency: a worktree path is "valid" if .git exists as a file (linked
# worktree marker) or as a directory (the canonical repo itself).
if [ -e "$WORKTREE/.git" ]; then
  echo "init-agent-worktree.sh: worktree already exists at $WORKTREE"
  exit 0
fi

# Ensure parent dir exists, then create the worktree on main.
mkdir -p "$(dirname "$WORKTREE")"
echo "init-agent-worktree.sh: creating worktree for agent=$AGENT at $WORKTREE"
git -C "$FRAMEWORK_ROOT" worktree add "$WORKTREE" main
