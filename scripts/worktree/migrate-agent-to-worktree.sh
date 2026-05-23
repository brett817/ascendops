#!/bin/bash
# migrate-agent-to-worktree.sh
# One-shot migration helper. Creates the worktree if missing and prints the
# next-step guidance (cd into worktree + verify identity + safe-mode flag).
#
# Usage:
#   migrate-agent-to-worktree.sh [<agent>]

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
AGENT="${1:-${CTX_AGENT_NAME:-}}"
if [ -z "$AGENT" ]; then
  echo "migrate-agent-to-worktree.sh: AGENT required (positional arg or CTX_AGENT_NAME env)" >&2
  exit 2
fi

"$SCRIPT_DIR/init-agent-worktree.sh" "$AGENT"

WORKTREE_PATH=$("$SCRIPT_DIR/agent-worktree-path.sh" "$AGENT")

cat <<NEXTSTEP

Migration complete for agent=$AGENT.

Worktree path: $WORKTREE_PATH

NEXT STEPS:
  1. cd $WORKTREE_PATH
  2. Verify: git rev-parse --is-inside-work-tree (expect 'true')
  3. Verify: git rev-parse --git-common-dir (expect canonical $CTX_FRAMEWORK_ROOT/.git)
  4. For new tasks: 'git fetch origin && git checkout -b chore/<task> origin/main'

All subsequent git commands MUST run from inside the worktree. The canonical
checkout at \$CTX_FRAMEWORK_ROOT stays for Dane (orchestrator) only.
NEXTSTEP
