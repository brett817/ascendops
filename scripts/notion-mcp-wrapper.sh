#!/usr/bin/env bash
# notion-mcp-wrapper.sh
# Loads the Notion MCP bearer token from ~/.claude/credentials/notion-mcp.json
# and launches the official Notion MCP server without embedding plaintext
# credentials in ~/.claude/mcp.json.

set -euo pipefail

CREDENTIALS_FILE="${HOME}/.claude/credentials/notion-mcp.json"

if [[ ! -r "${CREDENTIALS_FILE}" ]]; then
  echo "ERROR: cannot read ${CREDENTIALS_FILE}" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required to read ${CREDENTIALS_FILE}" >&2
  exit 1
fi

NOTION_API_KEY="$(jq -r '.api_key // empty' "${CREDENTIALS_FILE}")"
if [[ -z "${NOTION_API_KEY}" ]]; then
  echo "ERROR: .api_key missing in ${CREDENTIALS_FILE}" >&2
  exit 1
fi

export NOTION_API_KEY
export OPENAPI_MCP_HEADERS="$(jq -nc --arg token "${NOTION_API_KEY}" '{"Authorization":("Bearer " + $token),"Notion-Version":"2022-06-28"}')"

exec npx -y @notionhq/notion-mcp-server "$@"
