#!/usr/bin/env python3
"""
pm-colocated-detect.py — Path 2 v1 detector for co-located unlinked melds.

Rebuilt 2026-05-13 after orgs/ascendops/agents/aussie/scripts/ was wiped by
the doc-eater bug. Original lived at the same logical path before the wipe;
this rebuild lands in scripts/agents/aussie/ (git-tracked, outside orgs/)
so a repeat wipe cannot remove it.

Reads OPEN melds from PM Nexus API, normalizes property prefix from
unit_address.full_address, clusters by property key, then classifies each
multi-meld cluster as:
  - MISMATCH  : cluster has BOTH linked (project!=null) and unlinked melds
  - ALL-UNLINKED : cluster of 2+ melds, all with project==null

Writes cluster JSON to:
  $CTX_ROOT/orgs/$CTX_ORG/state/$CTX_AGENT_NAME/colocated-clusters-YYYY-MM-DD.json

Dane's 07:30 morning brief reads that state file for surfacing.

Auth: PM_CLIENT_ID + PM_CLIENT_SECRET must be in environment.

DRIFT vs original §10.3 spec (committed to commit body per Dane request):
  - "Open" status set = {PENDING_ASSIGNMENT, PENDING_MORE_MANAGEMENT_AVAILABILITY}
    (confirmed against live API on 2026-05-13: 26 open melds total)
  - Property-key normalization: first comma-separated segment, lowercase,
    strip trailing " - Unit X" / " - Lot X" suffix
  - UNIT-MISSING bucket deferred to v1.1 per memory entry
  - Single-family vs multi-unit gating NOT implemented in v1 detector
    (was a v2 amendment; safe to compute in messenger if needed)
"""
import datetime as dt
import json
import os
import re
import ssl
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

API_BASE = "https://app.propertymeld.com/api/v2"
TOKEN_URL = "https://app.propertymeld.com/api/v2/oauth/token/"
MULTITENANT_ID = os.environ.get("PM_MULTITENANT_ID", "3287")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

OPEN_STATUSES = ("PENDING_ASSIGNMENT", "PENDING_MORE_MANAGEMENT_AVAILABILITY")

_token_cache = {}


def get_token():
    if _token_cache.get("token"):
        return _token_cache["token"]
    client_id = os.environ.get("PM_CLIENT_ID")
    client_secret = os.environ.get("PM_CLIENT_SECRET")
    if not client_id or not client_secret:
        print(json.dumps({"ok": False, "error": "PM_CLIENT_ID / PM_CLIENT_SECRET not set"}), file=sys.stderr)
        sys.exit(2)
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=data, headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=15) as r:
        body = json.loads(r.read())
    _token_cache["token"] = body["access_token"]
    return body["access_token"]


def api_get(path, params=None):
    url = f"{API_BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {get_token()}",
        "X-Multitenant-Id": MULTITENANT_ID,
        "User-Agent": UA,
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=20) as r:
        return json.loads(r.read())


def fetch_open_melds():
    melds = []
    for status in OPEN_STATUSES:
        offset = 0
        while True:
            page = api_get("/meld/", {"status": status, "limit": 100, "offset": offset})
            results = page.get("results", []) if isinstance(page, dict) else page
            melds.extend(results)
            if not isinstance(page, dict) or not page.get("next"):
                break
            offset += 100
    return melds


_UNIT_SUFFIX = re.compile(r"\s*-\s*(unit|lot|apt|apartment|suite|ste|#)\s+.+$", re.IGNORECASE)


def normalize_property_key(full_address):
    if not full_address:
        return None
    head = full_address.split(",", 1)[0].strip()
    head = _UNIT_SUFFIX.sub("", head)
    return head.lower().strip()


def cluster_melds(melds):
    by_key = defaultdict(list)
    sample_addr = {}
    for m in melds:
        addr = (m.get("unit_address") or {}).get("full_address")
        key = normalize_property_key(addr)
        if not key:
            continue
        by_key[key].append(m)
        sample_addr.setdefault(key, addr)
    return by_key, sample_addr


def _project_id(m):
    p = m.get("project")
    if isinstance(p, dict):
        return p.get("id")
    return p  # int or None


def categorize(by_key, sample_addr):
    mismatch = []
    all_unlinked = []
    for key, group in by_key.items():
        if len(group) < 2:
            continue
        linked = [m for m in group if _project_id(m)]
        unlinked = [m for m in group if not _project_id(m)]
        if linked and unlinked:
            mismatch.append({
                "property_key": key,
                "sample_address": sample_addr[key],
                "linked_melds": [
                    {
                        "ref": m.get("reference_id"),
                        "id": m.get("id"),
                        "unit_id": m.get("unit"),
                        "project_id": _project_id(m),
                        "status": m.get("status"),
                    } for m in linked
                ],
                "unlinked_melds": [
                    {
                        "ref": m.get("reference_id"),
                        "id": m.get("id"),
                        "unit_id": m.get("unit"),
                        "status": m.get("status"),
                        "creator": m.get("creator"),
                    } for m in unlinked
                ],
            })
        elif len(unlinked) >= 2 and not linked:
            all_unlinked.append({
                "property_key": key,
                "sample_address": sample_addr[key],
                "melds": [
                    {
                        "ref": m.get("reference_id"),
                        "id": m.get("id"),
                        "unit_id": m.get("unit"),
                        "status": m.get("status"),
                        "creator": m.get("creator"),
                    } for m in unlinked
                ],
            })
    mismatch.sort(key=lambda c: c["property_key"])
    all_unlinked.sort(key=lambda c: c["property_key"])
    return mismatch, all_unlinked


def build_would_send(mismatch_clusters):
    out = []
    for c in mismatch_clusters:
        siblings = ", ".join(
            f"{m['ref']} → project P-{m['project_id']}"
            for m in c["linked_melds"]
        )
        for u in c["unlinked_melds"]:
            text = (
                f"Auto-detected: this meld ({u['ref']} @ {c['sample_address']}) "
                f"appears co-located with linked meld(s) at the same property. "
                f"Linked siblings: {siblings}. Please join this meld to the "
                f"existing project, or create a new project if this is a "
                f"separate turnover wave. — Aussie detector"
            )
            out.append({
                "meld_id": u["id"],
                "meld_ref": u["ref"],
                "target_user_id": u["creator"],
                "channel": "meld_comment",
                "category": "MISMATCH",
                "text": text,
            })
    return out


def state_dir():
    ctx_root = os.environ.get("CTX_ROOT", os.path.expanduser("~/.cortextos/default"))
    org = os.environ.get("CTX_ORG", "ascendops")
    agent = os.environ.get("CTX_AGENT_NAME", "aussie")
    d = Path(ctx_root) / "orgs" / org / "state" / agent
    d.mkdir(parents=True, exist_ok=True)
    return d


def main():
    melds = fetch_open_melds()
    by_key, sample = cluster_melds(melds)
    mismatch, all_unlinked = categorize(by_key, sample)
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "version": "v1-dryrun-rebuild-2026-05-13",
        "open_meld_count": len(melds),
        "clusters": {
            "mismatch": mismatch,
            "all_unlinked": all_unlinked,
        },
        "would_send": build_would_send(mismatch),
        "deferred": {
            "unit_missing": "v1.1 — needs property attribution path for null-unit melds",
            "in_app_mail_path_B": "v2.1 — PM in-app mail API not exposed in snapcli",
        },
    }
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    out_path = state_dir() / f"colocated-clusters-{today}.json"
    out_path.write_text(json.dumps(payload, indent=2))
    print(json.dumps(payload, indent=2))
    print(f"\n# wrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
