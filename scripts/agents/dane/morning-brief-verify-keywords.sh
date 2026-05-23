#!/bin/bash
# morning-brief-verify-keywords.sh
#
# Pre-dispatch verify step for Dane's morning-review skill.
# Per locked rule (feedback_artifact_state_search_by_keyword_not_timestamp 5/22):
# before listing a proposed task in the morning brief, check if work matching
# the title keyword has already shipped in the prior 24h across noogalabs repos.
#
# Usage:
#   morning-brief-verify-keywords.sh "<task-title>" [<agent-name>] [<window-hours>]
#
# Output:
#   SHIPPED: keyword=<kw> repo=<repo> pr=<url> merged=<ts> title="<title>"
#     → exit 0; SKIP this task in the brief, the work already landed
#   NOT-FOUND: no matching merged PR in prior Nh ...
#     → exit 1; PROCEED with task creation as normal
#   NO-KEYWORDS: title too generic; cannot verify by keyword
#     → exit 1; proceed (graceful fallback — manual judgment)
#
# Trigger context: PR #14 noogalabs/blue-voice-gateway "/version refactor"
# merged 02:57Z but Dane's morning brief 5/22 listed it as a proposed task
# for codie (since-timestamp filter missed it). Dane revealed false-stall
# diagnosis 16:35Z. This script closes that gap before it fires again.

set -uo pipefail

TITLE="${1:-}"
AGENT="${2:-}"           # reserved for future agent-author-filter use
WINDOW_HOURS="${3:-24}"

if [ -z "$TITLE" ]; then
  echo "Usage: $0 <task-title> [<agent-name>] [<window-hours>]" >&2
  exit 2
fi

# Stopwords — common English + workflow verbs that aren't distinctive enough
# to search on. Keep this list short; over-filtering causes false NOT-FOUND.
STOPWORDS=(a an the is are was on in for to of and or run do done that this from with by as it be at any all new old run task work review check test fix make use add update create draft scope spec note item ship pass step over only just then than what when where need next prior bank lock open close start stop send sent kick pick pull push tell call rule role agent agents based first into pull push tell call rule role agent agents based first into final more most none some both each per via case area path file name code data line list show find lane help info read view kind type call hold mark grep skip drop dump line list set sum)

# Lowercase + tokenize (alphanumeric only, drop punctuation), filter for >=4 chars,
# preserve FIRST-OCCURRENCE ORDER (not alphabetical sort) so domain-meaningful
# terms early in the title aren't dropped by the top-N cap below.
KEYWORDS=$(echo "$TITLE" | tr -c '[:alnum:]' ' ' | tr '[:upper:]' '[:lower:]' | awk '{
  for(i=1;i<=NF;i++) if(length($i)>=4 && !seen[$i]++) print $i
}')

# Filter stopwords
FILTERED=()
for kw in $KEYWORDS; do
  skip=false
  for sw in "${STOPWORDS[@]}"; do
    if [ "$kw" = "$sw" ]; then skip=true; break; fi
  done
  $skip || FILTERED+=("$kw")
done

# Cap to top 3 distinct keywords (by first-encountered order from sort -u)
TOP_KEYWORDS=("${FILTERED[@]:0:3}")

if [ ${#TOP_KEYWORDS[@]} -eq 0 ]; then
  echo "NO-KEYWORDS: title too generic; cannot verify by keyword (title: $TITLE)"
  exit 1
fi

# Compute since-window ISO timestamp; macOS BSD date vs GNU date
SINCE=$(date -u -v-${WINDOW_HOURS}H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
        || date -u -d "${WINDOW_HOURS} hours ago" +%Y-%m-%dT%H:%M:%SZ)

# Repos to search — keep aligned with active noogalabs surface
REPOS=(noogalabs/cortextos noogalabs/ascendops noogalabs/cli-anything-pm noogalabs/blue-voice-gateway)

for kw in "${TOP_KEYWORDS[@]}"; do
  for repo in "${REPOS[@]}"; do
    # Restrict to PR title (in:title) — full-text body match catches PRs that
    # just mention the keyword in passing (false-positive risk). Title-only =
    # high signal that the PR is actually ABOUT this topic.
    HIT=$(gh pr list --repo "$repo" --state merged \
          --search "$kw in:title merged:>$SINCE" \
          --json title,url,mergedAt --jq '.[0] // empty' 2>/dev/null) || continue
    if [ -n "$HIT" ]; then
      URL=$(echo "$HIT" | jq -r .url)
      MERGED=$(echo "$HIT" | jq -r .mergedAt)
      MATCHED_TITLE=$(echo "$HIT" | jq -r .title)
      echo "SHIPPED: keyword=$kw repo=$repo pr=$URL merged=$MERGED title=\"$MATCHED_TITLE\""
      exit 0
    fi
  done
done

echo "NOT-FOUND: no matching merged PR in prior ${WINDOW_HOURS}h across noogalabs repos for keywords: ${TOP_KEYWORDS[*]}"
exit 1
