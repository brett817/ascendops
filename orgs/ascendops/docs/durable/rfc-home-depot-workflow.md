# RFC: Home Depot Workflow — receipt → AppFolio PO → meld attachment

**Author:** Collie
**Date:** 2026-04-29
**Status:** Draft, awaiting David review
**Item:** Thursday plate #5 (of 13)
**Companions:** PM CLI hook gate (#1, shipped) closes the meld-side documentation gap; this RFC closes the materials-side gap.

---

## 1. Problem

Carlos and other in-house techs buy materials at Home Depot. Receipts land in `david@noogalabs.com` Gmail with label `home-depot-receipts` (Label_76, configured at `orgs/ascendops/agents/dane/config.json:82`).

**Today's manual flow:**
1. David sees the Gmail receipt.
2. David opens AppFolio, manually creates a purchase order against the property/unit.
3. David manually attaches the PO to the relevant meld in PM (or skips this step).

**Cost of the manual flow:**
- Time: ~2-4 minutes per receipt × ~15-25 receipts/week = 30-90 min/week of David's attention.
- Misses: receipts that arrive while David is heads-down get triaged late or lost. Symptom — the same set of meld-side no-docs closes (Carlos pattern fixed by hook gate #1) has a parallel materials-side equivalent: meld closes without PO attached, downstream billing reconciliation against AppFolio breaks.
- Errors: which meld did Carlos buy parts for? If he bought parts at 09:30 and worked melds T0001 / T0002 / T0003 between 08:00-12:00, the manual link is a guess. Wrong attachment poisons billing.

**What's already in place:**
- Gmail watch in fast-checker has `home_depot_label_id: "Label_76"` (`dane/config.json:82`) — but **no code path consumes that label distinctly**. It currently flows through the same generic Gmail watch alert as other emails.
- `cli-anything-appfolio` (`/Users/davidhunter/projects/cli-anything-appfolio`) has `af probe / work-orders list / units list/get / properties list`. **No PO command** — PO creation would be net-new, session-captured-headers via the same OpenCLI mechanism.
- AppFolio API is permanently blocked (per `project_appfolio_no_api.md`) — all integration is via the `af` CLI session-captured headers, NOT via API approval.

## 2. Goals / Non-Goals

**Goals**
- New `home_depot_label_id` consumer in fast-checker that distinct-routes receipt emails to a dedicated handler (separate from generic Gmail watch alerts).
- Receipt parser that turns the Home Depot email into a structured object (line items, total, store, date, last-4 of payment).
- AppFolio PO creator command (`af purchase-orders create`) backed by a session-captured POST endpoint.
- Meld-matcher that proposes ≥1 candidate meld using date/tech/address signals, with a confidence score.
- Manual-confirm UX via Telegram for any match below the auto-attach confidence threshold (default = manual until calibrated).

**Non-Goals**
- **Not a procurement system.** No catalog, no approval-before-purchase, no budget enforcement.
- **Not AP automation.** No bill payment, no vendor onboarding, no Quickbooks sync.
- **Not OCR-from-the-receipt-paper.** Carlos doesn't photograph receipts; we only consume the Gmail email Home Depot sends.
- **Not multi-vendor.** This RFC is Home Depot specifically. Lowe's, Ace, etc. = separate adapters following the same pattern.

## 3. Data Flow

```
Gmail (label: home-depot-receipts)
   │
   ├─ fast-checker.checkGmailWatch()  [existing, src/daemon/fast-checker.ts:519]
   │   └─ NEW: branch on label_id == home_depot_label_id → route to receipt handler
   │
   ▼
Receipt Handler (new, src/daemon/home-depot-handler.ts)
   │
   ├─ Fetch full message body via gws gmail get
   ├─ Parse → ReceiptStruct { date, total, line_items, store, payment_last4, raw_msg_id }
   ├─ On parse failure → fall through to manual-confirm with error context
   │
   ▼
Meld Matcher (new, src/bus/meld-match.ts)
   │
   ├─ Inputs: ReceiptStruct + active in-house techs + recent meld activity (last 72h)
   ├─ Score candidates by: tech identity, ±48h date proximity, address line-item match
   ├─ Output: top-3 candidates with confidence ∈ [0, 1]
   │
   ├─ confidence ≥ 0.85 → auto-attach
   ├─ 0.5 ≤ confidence < 0.85 → Telegram manual-confirm to David
   ├─ confidence < 0.5 → Telegram "no good match" with top-3, manual select
   │
   ▼
AppFolio PO Creator (new af command)
   │
   ├─ af purchase-orders create --property <id> --unit <id> --vendor home-depot
   │      --total $X --line-items "..." --receipt-msg-id <gmail_id>
   ├─ Returns AppFolio PO id
   │
   ▼
Meld Attacher
   │
   ├─ pm work-orders send-message --meld-id <id> --text "PO attached: af-PO-XXXX"
   │      --hidden-from-tenant --hidden-from-vendor   [internal note]
   ├─ Future: cli-anything-snapcli adds an actual file/link attach if PM supports it
   │
   ▼
Telegram receipt → David: "✓ Home Depot $X.XX → meld TXXXXX → AppFolio PO af-XXXX"
```

Error handling at each stage: parse fail → manual; AppFolio create fail → log + retry-once + manual; PM attach fail → PO exists, just no link, manual cleanup. Never throw — always degrade to manual confirm.

## 4. Receipt Parsing

Home Depot's email receipt has stable HTML structure (verified empirically — but a sample N=10 over the next 2 weeks should validate):

| Field | Source | Reliability |
|---|---|---|
| Total | regex on `Total: \$X.XX` | high |
| Date | message `Date:` header | high |
| Store # | regex on `Store: \#XXXX` in body | high |
| Payment last-4 | regex on `Card ending in XXXX` | medium (sometimes redacted) |
| Line items | HTML table parse | medium (depends on email-formatter version) |
| Tax | regex on `Tax: \$X.XX` | high |

If Home Depot ever ships PDF-attachment receipts (some emails do, some don't), fallback to PDF text extraction via a tool like `pdftotext` (already on macOS). OCR via Tesseract is the absolute last resort — unreliable, slow, and probably unnecessary if HTML/PDF text extraction works.

Parser ships with a `--dry-run` mode that emits the parsed struct without doing anything else. Use it for the validation N=10 soak before turning auto-attach on.

## 5. AppFolio PO Creation

Net-new `af purchase-orders create` command in `cli-anything-appfolio/cli_anything/appfolio/cli.py`. Backend uses session-captured headers (the OpenCLI pattern documented in `project_appfolio_no_api.md`).

Required AppFolio fields (verify against live UI by capturing one manual PO POST):
- `property_id` — derived from meld → unit → property
- `unit_id` — derived from meld
- `vendor_id` — Home Depot is a single AppFolio vendor record; cache the ID at first lookup
- `total_amount`, `tax`, `description`
- `line_items[]` (optional but useful)
- `receipt_attachment` — multipart upload of the email body or its PDF if present

Endpoint discovery: capture a real PO creation in Safari → extract POST URL + body shape → mirror in CLI. Mirrors the Safari binary cookie pattern documented in `pm-cli-harness/SKILL.md`.

## 6. Meld Matching Strategy

Signals scored 0-1, weighted-summed:

| Signal | Weight | How |
|---|---|---|
| Tech identity match (Carlos bought it AND a Carlos meld is in-flight ±48h) | 0.4 | Compare receipt-date to `pm work-orders list --tech Carlos --status pending,in-progress` |
| Date proximity ±48h | 0.2 | Receipt date vs meld in-flight window |
| Address match in line items (rare) | 0.2 | Some receipts include "delivered to" — match against meld unit_address |
| Work-category match (e.g. plumbing parts → plumbing meld) | 0.1 | Map line-item categories to PM `work_category` field |
| Single-meld-in-flight at receipt time | 0.1 | If only 1 meld is open for that tech, near-certainty |

Confidence = weighted sum, clamped [0,1].

Auto-attach threshold: 0.85. Calibration: log every auto-attach + manual-confirm decision for 4 weeks. Compare auto-attach decisions against David's after-the-fact corrections. Adjust threshold by quarterly review.

## 7. Manual-Confirm UX

For every receipt below the auto-threshold, send a Telegram message to David's chat:

```
🛒 Home Depot $43.27 (Store 0772, 04/29 09:14)
Line items: 2x SharkBite 1/2", 1x PEX cutter
Top candidates:
  1. T78PZXMB  — Carlos / Willie Wade plumbing  (conf 0.78)
  2. TFW91M4   — Carlos / William Spear shower  (conf 0.41)
  3. (no match — file standalone)
Reply: 1 / 2 / 3 / skip
```

Default = "manual until calibrated." Auto-attach turns on per-tech, after at least 20 confirmed-correct manual decisions for that tech. Carlos first (highest receipt volume), then Casey/Silvano.

## 8. Failure Modes

| Failure | Detection | Mitigation |
|---|---|---|
| No matching meld within ±48h | Top candidate confidence < 0.5 | File as standalone PO in AppFolio (no meld link); flag in monthly review |
| Multi-meld split purchase (one trip, parts for 3 melds) | Line items span multiple work_categories | Manual-confirm always; surface a "split this PO" Telegram option (creates N POs, asks user to allocate dollars) |
| Returns / refunds | Negative total in receipt | Log only; no auto-create. Refunds need manual reconciliation against the prior PO |
| Non-Home-Depot receipt mis-labeled | Receipt parser fails on schema | Manual-confirm with the parse error; David can re-label |
| Carlos buys for personal use accidentally | No matching meld + tech identity match | Standalone PO at the property level → David sees it in monthly AppFolio review |
| AppFolio session expired | `af` returns 401 | Re-capture session per `cli-anything-appfolio` SKILL; queue pending receipts |
| Gmail watch missed a receipt (rare) | manual sweep query weekly | New skill `home-depot-weekly-sweep` runs every Monday for the prior 7 days, dedups against already-processed messages |

## 9. Migration

1. Land receipt parser in dry-run mode + a test corpus of 10 captured receipts. (1-2 days)
2. Capture AppFolio PO POST endpoint (manual one-time; document in `cli-anything-appfolio` SKILL). (half day)
3. Land `af purchase-orders create` command. (1 day)
4. Land meld-matcher with auto-attach disabled (always manual-confirm). (1-2 days)
5. Soak Carlos receipts only for 2 weeks; record decisions for calibration. (2 weeks)
6. Calibrate per-tech auto-attach threshold; turn on for Carlos.
7. Extend to Casey/Silvano after another 2-week soak each.

Rollback: disable the home-depot-handler branch in fast-checker; receipts revert to generic Gmail watch alerts (today's behavior). Already-created POs stay in AppFolio — no rollback needed there.

## 10. Open Questions for David

1. **Auto-attach confidence threshold of 0.85** — too strict (manual fatigue) or too loose (wrong-meld attachments)? Suggest reviewing after 4 weeks of confirmed data.
2. **Standalone POs (no meld match)** — file at property level, or hold in a "pending allocation" queue for weekly review?
3. **Carlos personal-use receipts** — how often does this happen? If non-zero, the matcher needs a "personal" classifier.
4. **AppFolio Home Depot vendor record** — there's only one Home Depot vendor in AppFolio currently, right? If multiple (per region), matcher needs vendor-disambiguation.
5. **Multi-vendor expansion** — once Home Depot is solid, what's the priority order? Lowe's, Ace, Ferguson, Sherwin-Williams? Each is a separate adapter; pick the volume order.
