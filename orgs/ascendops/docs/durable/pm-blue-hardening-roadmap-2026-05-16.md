# PM-Blue Hardening + Capture + Wishlist Roadmap
**Date:** 2026-05-16
**Source:** Blue's 3-bucket inventory + Dane synthesis
**Trigger:** David ask post-PR #5 merge: "how do we harden up + what other capture points + what does Blue want from her month of work"

---

## SYNTHESIS — THE CRITICAL PATH

Blue's response surfaces a clear chain: 3 items unlock 3 of the highest-value wishlist features. Sequence matters.

```
work-entries CLI commands  ──→  vendor-text-to-meld pipeline (THE BIG ONE)
                                (Carlos/Stubblefield docs-gap closer)

Reports/dashboards capture ──→  vendor performance dashboard
                                ("is Stubblefield reliable?" answered programmatically)

Tenant SMS auto-match wiring ──→ inbound triage auto-link
                                 (Regina hot-water this morning was manual)
```

---

## BUCKET 1: HARDENING (this week)

### Verify Pass (passive — happens during normal Mon-Fri ops use)
**P1 (load-bearing daily critical path):**
- `pm assign-tech` — NEW PR #5, replaces Playwright workaround
- `pm work-orders complete` — closeout daily decisions
- `pm work-orders merge` — load-bearing for closed-meld clone-fix workflow

**P2 (within 2 weeks):**
- `pm work-orders cancel`, `pm work-orders update-notes` (NEW PR #5)
- `pm-dev projects edit/create-meld-in/detach-meld`
- `pm receipts upload` (needs open meld — failed on closed test)

**P3 (opportunistic):**
- `pm estimates create/update/link`, `pm upload-file --as tenant/vendor`, `pm api-keys rotate`

### CLI Catchup (active — Codie / Collie build work)
**P1 [HIGHEST IMPACT]:**
- `pm work-orders create-work-entry / update-work-entry / delete-work-entry` — backend exists, no CLI surface. Direct unlock for vendor-text-to-entry pipeline.

**P2:**
- `pm work-orders hold-invoice / decline-invoice`

**P3:**
- `pm projects delete`, `pm work-orders delete-file`, vendor-side commands (requires per-vendor creds first)

---

## BUCKET 2: CAPTURE GAPS (places David still needs to click)

Estimated 15-20 min capture session covers all P1+P2 items together.

**P1:**
- **Reports / dashboards page** — likely `/3287/m/3287/reports/`. Need: vendor performance, response time, completion rate. Unlocks the entire vendor performance dashboard wishlist item.

**P2:**
- **Recurring melds / templates** — settings or templates area. The `recurring_meld` field exists in meld JSON but we've never created one. Unlocks Brittany's annual maintenance calendar.
- **Bulk operations** — meld list view, multi-select checkbox + bulk action dropdown. Closes mass-reassign on vendor switch scenarios.
- **Owner approval flow** — meld detail when `owner_approval_status` changes. $500+ estimates need this; today handled manually offline.

**P3:**
- Estimate approve/reject (David doesn't use), notification settings per persona, property/unit + vendor profile edit

---

## BUCKET 3: WISHLIST (Blue's month-of-work pain points)

**P1 — Direct unlocks from Bucket 1 + 2 work:**
1. **Vendor-text-to-meld pipeline [THE BIG ONE]** — vendor texts "I finished 1208 Sholar, here's a photo" → agent matches by name/address → posts comment + uploads photo + creates work-entry. Direct fix for the docs-gap that spawned the vendor-tech-status-sweep skill. **REQUIRES: work-entries CLI POST (Bucket 1).**
2. **Tenant SMS → meld auto-matching** — Regina hot-water SMS this morning required manual phone-search. Auto-link inbound SMS by phone. **Endpoints already available** — purely wiring work, no new captures needed.
3. **Vendor performance dashboard** — auto-compute avg response, completion rate, no-shows per vendor. **REQUIRES: reports endpoint capture (Bucket 2).**

**P2:**
4. Stuck-meld / SLA detector (would have caught Friday's late closeouts earlier)
5. Cluster detection auto-suggest (Wendilea + Cove Hills clusters Blue eyeballed Friday)
6. Recurring meld templates (Brittany's calendar codified) — requires Bucket 2 recurring capture
7. Photo backlog audit (vendor coaching surface, today invisible)

**P3:**
8. Vendor dispatch templates
9. Stale-thread detector
10. Cross-property pattern alerts
11. Owner brief auto-generation

---

## RECOMMENDED EXECUTION SEQUENCE

### Week 1 (May 19-23)
- **Mon AM:** P1 verify items via normal use (Blue logs CONFIRMED tags as she goes)
- **Mon-Wed:** Codie/Collie build work-entries CLI commands (3 subcommands, mirrors backend functions) → ship as `cli-anything-pm` PR
- **Wed-Thu:** Wire tenant SMS auto-matching (Blue-side, endpoints already exist) → no capture, no new PRs, just integration work
- **Fri:** 15-20 min capture session with David — reports + recurring + bulk + owner approval

### Week 2 (May 26-30)
- Build vendor-text-to-meld pipeline (work-entries CLI + matching logic + agent intake) → big wishlist item shipped
- Build vendor performance dashboard (reports endpoints + computation + surface) → second big wishlist item shipped
- P2 verify pass completes via normal use

### Week 3+
- Bulk ops + recurring meld + owner approval CLI surfaces
- P2 wishlist items (SLA detector, cluster detection, photo backlog audit)

---

## HONEST RISK FLAGS

- Bucket 1 verify list looks long but most clears passively during normal Mon-Fri ops use. Not 11 days of active work.
- Bucket 2 captures need 15-20 min of David's time + a capture-clean run (Playwright HAR pattern from Friday). Worth scheduling as one batch.
- Bucket 3 P1 items have hard dependencies on Bucket 1 + 2. Sequencing matters — can't ship vendor-text pipeline before work-entries CLI.
- Vendor-side actions (P3 Bucket 1) need per-vendor PM accounts that don't exist for default install. Real value is for users running vendor-mirror setups (eg in-house maintenance LLC with own PM vendor account). Don't build before there's user demand.

---

## DAVID DECISION POINTS

1. Approve the execution sequence as drafted, or reshuffle priorities?
2. Schedule the 15-20 min capture session — Mon, Tue, Wed best fit?
3. Greenlight Codie/Collie to start work-entries CLI commands (Mon)?
4. Anything from Blue's wishlist that should jump to P1 that you'd rate differently?
