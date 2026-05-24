# MMS Inbound Follow-Up Spec: Closed-Meld Window + Ask-Back

Date: 2026-05-23
Owner: codie
Status: Draft for Dane review (pre-code)

## Goal
Improve inbound MMS routing so valid late photo submissions can still attach to a recent closed meld, while unresolved cases trigger an ask-back flow instead of silent skip.

## Scope
1. Expand sender-based meld candidate pool to include:
- Open melds (current behavior)
- Closed melds closed within last 7 days (`N=7` default)

2. Routing behavior on inbound MMS:
- If exactly one strongest candidate found in pool: attach media to that meld and send confirmation
- If no candidate in pool: trigger ask-back prompt and enqueue media for follow-up reply parsing

3. Keep parser-first behavior from PR #12 unchanged:
- Text body parse for meld ID/address remains first path
- Sender-based lookup remains fallback when parser misses

## Explicitly Out of Scope
- Reintroducing vendor/tech phone-roster lookup architecture changes beyond current sender-based function boundaries
- Changing anti-spam policy or broadening allowlist rules
- Large queue subsystem redesign (only no-active-meld hook + existing queue path)

## Proposed Logic Changes
1. `findMeldForSender` / `pickLatestMeld` path:
- Replace strict open-only filter with bounded window filter:
  - Include `isActiveMeld(m)` OR `isClosedWithinDays(m, 7)`
- Prefer open melds over closed melds when both exist
- Within same class, pick most recently updated

2. No-match path integration:
- Current `no-active-meld` skip path becomes:
  - enqueue media in ask-sender queue
  - send ask-back SMS: "Got your photo(s). Which meld is this for? Reply with address or meld ID (T...)."
  - return handled action that reflects queued state (not silent skip)

3. Closed-window boundary:
- `N=7` as constant/config default in code
- Closed meld outside window behaves as no-match => ask-back

## Acceptance Vectors
1. Vendor match + open meld exists:
- Result: unchanged happy path, media attached to open meld, confirmation sent

2. Vendor match + no open meld + closed meld within 7 days:
- Result: media attached to recent closed meld, confirmation sent

3. Vendor match + only closed meld older than 7 days:
- Result: ask-back prompt sent, media queued

4. No sender match / no candidate:
- Result: ask-back prompt sent, media queued

5. Parser-first success (meld ID/address in first MMS body):
- Result: sender lookup not required; media attached directly (unchanged)

## Observability
Add structured log fields for outcome clarity:
- `lookup_pool_counts` (open_count, recent_closed_count)
- `selected_meld_status` (`open` | `closed_recent` | `none`)
- `ask_back_sent` boolean
- `queue_enqueued` boolean

## Risks and Mitigations
- Risk: attaching to wrong closed meld if sender has many historical records
  - Mitigation: 7-day window limit + open-preferred ordering + ask-back on ambiguity/no-match

- Risk: increased outbound prompts
  - Mitigation: prompt only when parser miss + no bounded candidate

## Test Plan
- Unit: filter includes closed-within-window and excludes older closed melds
- Unit: open-preferred candidate ordering
- Unit: no-match path invokes queue + ask-back
- Regression: parser-first path unaffected

## Rollout
- Single PR after review
- Keep behavior flags simple (`N=7` constant)
- Post-deploy smoke:
  - recent closed meld case
  - out-of-window closed meld case
  - no-match ask-back case
