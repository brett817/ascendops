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

# Honor CTX_AGENT_WORKTREE only when the caller is asking about their own
# agent. Cross-agent path lookups (e.g. dispatch helpers querying another
# agent's worktree path) must compute from CTX_ROOT, not inherit the
# current-agent override. (Codex bot P2 catch on PR #53, 2026-05-23.)
if [ -n "${CTX_AGENT_WORKTREE:-}" ] && [ "$AGENT" = "${CTX_AGENT_NAME:-}" ]; then
  echo "$CTX_AGENT_WORKTREE"
else
  echo "$CTX_ROOT_VAL/state/agents/$AGENT/worktree"
fi
