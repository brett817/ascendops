#!/bin/bash
# Path 2 cron wrapper — runs detector + messenger back-to-back.
#
# Rebuilt 2026-05-13 (lands at git-tracked path scripts/agents/aussie/
# instead of the original orgs/-tree location wiped by the doc-eater bug).
#
# Schedule: 07:15 ET Mon-Fri. Lands 15min before morning brief at 07:30
# so the brief reader has fresh state/aussie/colocated-clusters-YYYY-MM-DD.json
# to parse for the day's MISMATCH + ALL-UNLINKED clusters.
#
# DRY_RUN default: true (v1 safety per design §10.3). To flip live after David
# greenlights first morning's dry-run output, set DRY_RUN=false in agent env
# or override in this script.
#
# Auth: reads PM_CLIENT_ID + PM_CLIENT_SECRET from
# ~/.claude/credentials/property-meld-nexus.json.

set -euo pipefail

CREDS=~/.claude/credentials/property-meld-nexus.json
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -r "$CREDS" ]]; then
  echo "{\"ok\":false,\"error\":\"creds missing at $CREDS\"}" >&2
  exit 2
fi

export PM_CLIENT_ID="$(python3 -c "import json; print(json.load(open('$CREDS'))['client_id'])")"
export PM_CLIENT_SECRET="$(python3 -c "import json; print(json.load(open('$CREDS'))['client_secret'])")"
export DRY_RUN="${DRY_RUN:-true}"

# Phase 1: detect + cluster + write state file
python3 "$SCRIPT_DIR/pm-colocated-detect.py"
detect_rc=$?

# Phase 2: messenger (dry-run by default; logs intent, no PM writes)
python3 "$SCRIPT_DIR/pm-colocated-message.py"
msg_rc=$?

if [[ "$detect_rc" -ne 0 || "$msg_rc" -ne 0 ]]; then
  echo "{\"ok\":false,\"detect_rc\":$detect_rc,\"msg_rc\":$msg_rc}" >&2
  exit 1
fi
