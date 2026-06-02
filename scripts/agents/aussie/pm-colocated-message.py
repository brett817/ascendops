#!/usr/bin/env python3
"""
pm-colocated-message.py — Path 2 v1 messenger (dry-run default).

Rebuilt 2026-05-13 alongside pm-colocated-detect.py after the original
orgs/-tree scripts/ dir was wiped. Lands at git-tracked path.

Reads the cluster JSON produced by pm-colocated-detect.py (today's file)
and processes the `would_send` queue. In dry-run mode (DRY_RUN=true,
default per Path 2 design §10.3 v1 safety), it logs the queued messages
without contacting PM. In live mode (DRY_RUN=false), it posts each
message as a meld comment via the PM Nexus API.

DRIFT vs original §10.3 spec:
  - Live-mode meld-comment endpoint: POST /meld/{id}/comment/ (educated
    guess — pre-wipe original may have used a different shape). Path-B
    in-app mail deferred per detector's `deferred.in_app_mail_path_B`.
  - Sent-log path: $CTX_ROOT/orgs/$CTX_ORG/state/$CTX_AGENT_NAME/
    colocated-sent-log.jsonl (append-only, JSON lines).
  - On HTTP error in live mode: log the failure to sent-log with
    ok:false + error, continue to next message (graceful-tool-failure
    pattern, no hallucination).
"""
import datetime as dt
import json
import os
import ssl
import sys
import urllib.parse
import urllib.request
from pathlib import Path

API_BASE = "https://app.propertymeld.com/api/v2"
TOKEN_URL = "https://app.propertymeld.com/api/v2/oauth/token/"
MULTITENANT_ID = os.environ.get("PM_MULTITENANT_ID", "3287")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

_token_cache = {}


def get_token():
    if _token_cache.get("token"):
        return _token_cache["token"]
    cid = os.environ.get("PM_CLIENT_ID")
    sec = os.environ.get("PM_CLIENT_SECRET")
    if not cid or not sec:
        print(json.dumps({"ok": False, "error": "PM_CLIENT_ID/SECRET not set"}), file=sys.stderr)
        sys.exit(2)
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": cid,
        "client_secret": sec,
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


def state_dir():
    ctx_root = os.environ.get("CTX_ROOT", os.path.expanduser("~/.cortextos/default"))
    org = os.environ.get("CTX_ORG", "ascendops")
    agent = os.environ.get("CTX_AGENT_NAME", "aussie")
    d = Path(ctx_root) / "orgs" / org / "state" / agent
    d.mkdir(parents=True, exist_ok=True)
    return d


def load_today_clusters():
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    p = state_dir() / f"colocated-clusters-{today}.json"
    if not p.is_file():
        print(json.dumps({"ok": False, "error": f"cluster file missing: {p}"}), file=sys.stderr)
        sys.exit(3)
    return json.loads(p.read_text())


def post_meld_comment(meld_id, body_text):
    url = f"{API_BASE}/meld/{int(meld_id)}/comment/"
    payload = json.dumps({"comment": body_text}).encode()
    req = urllib.request.Request(url, data=payload, method="POST", headers={
        "Authorization": f"Bearer {get_token()}",
        "X-Multitenant-Id": MULTITENANT_ID,
        "User-Agent": UA,
        "Accept": "application/json",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=20) as r:
            return {"ok": True, "status": r.status, "body": r.read().decode(errors="replace")[:500]}
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}: {e.reason}", "body": e.read().decode(errors="replace")[:500]}
    except urllib.error.URLError as e:
        return {"ok": False, "error": f"URLError: {e.reason}"}


def main():
    dry_run = os.environ.get("DRY_RUN", "true").lower() != "false"
    clusters = load_today_clusters()
    queue = clusters.get("would_send", [])
    sent_log = state_dir() / "colocated-sent-log.jsonl"
    sent = []
    errors = []
    for item in queue:
        entry = {
            "ts": dt.datetime.now(dt.timezone.utc).isoformat(),
            "meld_id": item["meld_id"],
            "meld_ref": item["meld_ref"],
            "category": item.get("category"),
            "channel": item.get("channel"),
            "dry_run": dry_run,
            "text_preview": (item.get("text") or "")[:120],
        }
        if not dry_run:
            res = post_meld_comment(item["meld_id"], item["text"])
            entry["result"] = res
            if not res.get("ok"):
                errors.append(entry)
            else:
                sent.append(entry)
        else:
            entry["result"] = {"ok": True, "note": "dry-run; not posted"}
            sent.append(entry)
        with sent_log.open("a") as f:
            f.write(json.dumps(entry) + "\n")
    summary = {
        "ok": True,
        "dry_run": dry_run,
        "queue_size": len(queue),
        "sent_count": len([s for s in sent if not dry_run]),
        "dry_run_logged_count": len([s for s in sent if dry_run]),
        "error_count": len(errors),
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
