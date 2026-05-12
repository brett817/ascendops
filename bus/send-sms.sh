#!/usr/bin/env bash
# send-sms.sh — wrapper for Node.js CLI
# Usage: send-sms.sh <to_e164> <message> [--send-real --approved-by <approval_id>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="${SCRIPT_DIR}/../dist/cli.js"

exec node "$CLI" bus send-sms "$@"
