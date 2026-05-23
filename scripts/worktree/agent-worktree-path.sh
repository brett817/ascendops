#!/bin/bash
# agent-worktree-path.sh
# Echo the canonical worktree path for the given agent (or $CTX_AGENT_NAME).
# Useful for shell aliases: cd $(agent-worktree-path.sh)

set -uo pipefail

AGENT="${1:-${CTX_AGENT_NAME:-}}"
if [ -z "$AGENT" ]; then
  echo "agent-worktree-path.sh: AGENT required (positional arg or CTX_AGENT_NAME env)" >&2
  exit 2
fi

CTX_ROOT_VAL="${CTX_ROOT:-$HOME/.cortextos/default}"
echo "${CTX_AGENT_WORKTREE:-$CTX_ROOT_VAL/state/agents/$AGENT/worktree}"
