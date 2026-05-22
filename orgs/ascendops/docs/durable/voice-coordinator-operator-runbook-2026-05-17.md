# Voice Coordinator Demo — Operator Runbook

**Demo:** Ray Hespen call, Monday May 25, 2026, 5pm EDT
**Operator:** David Hunter
**Demo line:** +1 (423) 633-1021
**Author date:** 2026-05-17

---

This runbook is for you to skim during demo prep and have open (or printed) during the call. Action-first. If something breaks, jump straight to Section 2.

**One-line rescue:** If everything fails — hang up, redial. If it fails twice, switch to screenshare demo mode and walk Ray through the persona doc + tool list in the browser.

---

## 1. Pre-Demo Checklist (run 30 min before — 4:30pm EDT)

Work through these in order. Each one should take under a minute. Do not skip.

### 1a. Backend health check

Open a terminal and run:

```bash
curl https://blue-voice-gateway-production.up.railway.app/health
```

You should see JSON that includes `"ok": true`. If you don't — or the command hangs more than 5 seconds — **text Collie immediately**: "BACKEND DOWN, demo in 30." Do not try to fix it yourself.

### 1b. PM CLI auth check

In the same terminal:

```bash
pm work-orders list --limit 1 --json
```

| Result | Meaning | Action |
|---|---|---|
| JSON with 1 work order | Green light | Proceed |
| `401` or `"API Key no longer active"` | PM Nexus key rotated | See Section 2, "tool call failed" path. Text Collie. |
| Hangs / times out | Network or PM Nexus down | Text Collie URGENT. |

### 1c. Voice AI alive check

You don't need to log into Telnyx. Just call **+1 (423) 633-1021** from your cell. If an AI voice greets you, the assistant is live. If it rings out or hits voicemail, **text Collie URGENT**.

### 1d. Full dress-rehearsal call

Still calling from your cell, ask:

> "What's the status of work order [pick one open meld you know is real]?"

Confirm all four:
- [ ] AI greeted you
- [ ] AI picked the right branch (tenant vs. vendor vs. manager)
- [ ] AI fired `lookup_meld` and read the details back
- [ ] No weird pauses longer than ~3 seconds

If anything is off — wrong details, made-up info, dead air — **do not proceed**. Text Collie.

### 1e. Pick your demo melds NOW

Before the demo, write down on a sticky note:

- One real **open meld** at a real address (for Scenario A — duplicate catch)
- One real **plumbing meld assigned to Stubblefield** (for Scenario B — vendor scheduling)
- A **real tenant first name + address** you'd plausibly call about (for Scenario C — emergency)

Verify each is still open/assigned 5 minutes before Ray's call. Stale data = blown demo.

### 1f. Phone hygiene

- Silence Slack, iMessage previews, WhatsApp, anything that chimes
- Put your phone on Do Not Disturb except for Ray's number
- Have Ray's number queued in your dialer so you can call back fast if you drop

### 1g. Practice run

Run all 3 scenarios once between 4:30 and 4:55. Yes, even though you've seen them work. The muscle memory matters.

---

## 2. Mid-Demo Failure Modes (1-minute recovery each)

If something goes wrong on the live call, find the row, do the action. Don't improvise.

| Symptom | Likely cause | What to do on the call | What to do after |
|---|---|---|---|
| AI didn't answer / went to voicemail | Telnyx assistant disconnected, or backend down | Hang up. Wait 30 sec. Redial. If still failing, say to Ray "let me switch you to the screenshare view" and demo the persona doc + tool list in browser. | Text Collie URGENT: "VOICE AI NOT ANSWERING" |
| AI said "I'm having trouble pulling that up" | Graceful failure path fired — a tool call failed (Nexus key, stale cookie, Railway hiccup) | **This is a feature, not a bug.** Lean into it: "yeah, that's exactly the escalation flow we built — graceful degrade to human." Continue the call. | After call, text Collie: "graceful failure on [tool] for meld [N], log dive needed" |
| AI is making up data / saying things that aren't true | Persona drift OR tool response shape mismatch | **End the call gracefully.** Say "let me check on that and get back to you." Do NOT continue. | Text Collie URGENT: "AI HALLUCINATING — pull recording from [time]". Hard fail. |
| AI is slow / awkward 2-3 sec pauses | Kimi-K2.5 latency + PM CLI cold start | Nothing to do live. Acknowledge to Ray: "yeah, we're tightening this — Kimi is fast but the PM API roundtrip adds half a second." | Note for retro. |
| Call drops mid-sentence | Telnyx connection blip (rare) | Redial. | If it drops twice in a row, switch to screenshare demo. |
| AI assigned the wrong vendor / wrong tech | Should not happen — persona always `text_davids` first before dispatch | **End the call.** This is a hard fail. | Text Collie URGENT: "AI auto-dispatched — pull recording NOW" |

**Rule of thumb:** the AI is allowed to fail gracefully (Row 2). It is NOT allowed to lie (Row 3) or take destructive action without you (Row 6). Those two = stop the demo.

---

## 3. Demo Script — 3 Scenarios (5-7 min each)

Call **+1 (423) 633-1021** from your cell for each. You're playing different characters.

### Scenario A — Tenant calls about a leaky sink (duplicate catch)

**You play:** the tenant at your pre-picked open meld address.

**Opener:**
> "Hey, I'm calling about my unit at [real address]. There's a leak under the kitchen sink and it's getting worse."

**Expected AI behavior:**
1. Takes the address
2. Fires `recent_melds_for_property`
3. Finds your existing open meld
4. Says something like: "Looks like we already have that one open — work order [N]. I'll add a note that you called to check on it."
5. Ends the call cleanly

**What to highlight to Ray after:**
> "See how it caught the duplicate without me having to look anything up? That's the boring magic — every tenant call that's about an existing issue gets deduped automatically."

---

### Scenario B — Vendor calls to schedule a job

**You play:** a tech from Stubblefield Plumbing.

**Opener:**
> "Hey this is [name] from Stubblefield Plumbing, calling about work order [number of pre-picked plumbing meld]. I'd like to schedule for Wednesday at 10am."

**Expected AI behavior:**
1. Confirms the meld and that Stubblefield is the assigned vendor
2. Confirms back: "Wednesday May 28 at 10am Eastern — that right?"
3. You say "yep"
4. Fires `schedule_meld`
5. Reads back confirmation

**What to highlight to Ray after:**
> "Vendor self-serve scheduling. No manager in the loop, no SMS thread going back and forth all afternoon to nail down a window."

---

### Scenario C — After-hours emergency (only if demo runs past 6pm)

**You play:** the tenant.

**Opener:**
> "Hi this is [tenant first name] at [address] — there's water everywhere, it's pouring down through the ceiling from the upstairs unit."

**Expected AI behavior:**
1. URGENT keyword detection fires
2. `text_davids` is called with URGENT prefix
3. Tells you: "I'm getting David on this right now."
4. Your phone should buzz with the URGENT text within ~10 seconds — **show it to Ray on screen**

**What to highlight:**
> "The system knows what's an emergency vs. what can wait until morning. It doesn't try to be a hero — it gets me involved."

---

## 4. Post-Demo Cleanup (5 min after Ray hangs up)

Don't skip these. The retro depends on them.

### 4a. Pull the call recording

1. Go to https://portal.telnyx.com
2. Voice → Recordings
3. Filter by today's date
4. Download both channels as mp3 (caller + AI)

### 4b. Clean up demo data

List any melds you created or modified during the demo:

```bash
pm work-orders list --modified-since "5pm" --json
```

For each: either close it, or tag it `demo-data` so it doesn't pollute real ops reports.

### 4c. Export the AI transcript

Telnyx portal → Voice AI → Assistants → `blue-maint-coord-test` → Call History → today's calls → export transcripts.

### 4d. Report to Collie

Text Collie:

> "demo done, [N] scenarios run, [PASS/FAIL each]. Recording + transcript dropped at [path]."

Collie will ingest the recording + transcript into the private KB for the Tuesday retro.

---

## 5. What NEVER to Do During the Demo

- **Don't interrupt the AI mid-sentence.** Telnyx barge-in is enabled, but it sounds awkward live and confuses the persona's state machine.
- **Don't give the AI a real lockbox code** in a test scenario. It's instructed to refuse, but don't probe that live.
- **Don't promise Ray anything outside the demoed scope.** "Yeah, we can also do X" — punt every one of those to the follow-up call. "Great question, let me think on that and follow up."
- **Don't deploy or change anything during the demo window.** Collie has a freeze on Telnyx config from 4pm to 6pm EDT Monday 5/25. No exceptions.
- **Don't apologize for the AI being an AI.** Ray runs a PM company — he knows what he's looking at. Confidence > caveats.

---

## 6. After the Demo — Follow-up Sequence

| Timing | Action |
|---|---|
| Same day, within 1 hr of call end | Text Ray: "Thanks for the time today — recording and transcript coming over tonight." |
| Within 24 hours | Send Ray: (1) call recording, (2) transcript excerpt of best moment, (3) 1-pager on how the system works |
| Within 1 week | Book a deeper-dive technical Q&A call if Ray's interested |

Draft the 1-pager Sunday night so it's queued and ready to send.

---

## 7. Emergency Contacts (during demo window)

| Who | When | How |
|---|---|---|
| Collie (technical) | Anything voice-AI / backend / PM related | Telegram, status dashboard, or `cortextos bus send-message collie urgent "..."` |
| Dane (orchestration) | If Collie is unreachable for > 5 min | Telegram |
| Telnyx support | If Telnyx portal itself is down | portal.telnyx.com support chat. Account ID at `~/.claude/credentials/telnyx.json` |

---

## 8. Known Limits — Mention These Proactively to Ray

Better that Ray hears the limits from you than discovers them himself.

- **"Maintenance line only."** No leasing, no rent, no billing on this number. Scoped on purpose.
- **"It doesn't auto-create work orders from tenant calls yet."** That's intentional — it texts me, I create them. We'll likely add auto-create after a few weeks of supervised data.
- **"PM Nexus API key rotates periodically."** We have a self-heal, but if it fails mid-call the AI escalates gracefully to me. That's the same pattern you saw in Scenario [whichever fires].
- **"Voice quality is Telnyx Ultra — their top tier."** You may hear occasional weird intonations. Persona is tuned; voice settings are next on the list.

If Ray asks "what's next?" — three honest answers:
1. Auto-create work orders from tenant calls (after enough supervised data)
2. After-hours full coverage (currently business-hours optimized)
3. Outbound follow-up calls (right now it's inbound only)

---

## Bottom Line

You've practiced this. The tech works. Ray is here because he's curious, not because he's hunting for flaws. Lead with confidence, use the script, follow the failure-mode table if needed, and clean up after.

**If everything fails: hang up, redial, or switch to screenshare-demo mode.**

---

**File:** `/Users/davidhunter/cortextos/orgs/ascendops/docs/voice-coordinator-operator-runbook-2026-05-17.md`
