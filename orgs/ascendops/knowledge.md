# Organization Knowledge Base

Shared facts, context, and institutional knowledge for all agents in this org. Read on every session start. Update when you learn something that all agents should know.

## Universal Truth: Brand Split

This is a load-bearing rule for ALL external comms across the fleet. Get this wrong and customers see internal product names. Locked 2026-05-17 by David.

- **External / customer-facing brand: "Ascend Property Management"**
  - What residents, vendors, technicians, owners, and any caller-on-the-other-end hears
  - Use in: voice greetings, SMS bodies (including text_david), email copy, any caller-facing surface
  - Voice synth + SMS bus = always external regardless of recipient

- **Internal / software product: "AscendOps"**
  - The fleet platform / agent infrastructure we built
  - Use in: agent-to-agent bus messages, system labels, debug logs, code comments, file names, infra docs, internal slide decks, anything that NEVER reaches a phone screen or voice synth

**Rule of thumb:** if a human reads it on a phone or hears it spoken, it's Ascend Property Management. Everything else can be AscendOps.

## Universal Truth: External Persona Architecture

Locked 2026-05-18 by David. The target external-comms architecture across the AscendOps fleet:

- **One phone number per operator** (currently +1 423-633-1021 for Ascend Property Management). All inbound + outbound voice + SMS routes through it.
- **Alex is the front desk persona** — picks up every call by default. Handles maintenance intake fully. Also represents Ascend Property Management on SMS (no separate "Blue" externally — Blue is internal SMS execution runtime, never named to callers).
- **Specialist personas exist for distinct domains** (future expansion): Casey for leasing, Samantha for accounting, Victoria for Brittany's scheduling, [TBD-name] for David's scheduling. Each has its own voice + persona prompt + tool set, but all share the same phone number.
- **Transfer-to-specialist** happens via Telnyx Voice AI Call Control: Alex narrates the handoff ("Let me get Casey on the line, she handles leasing — one moment"), then the call is transferred internally to the specialist's Telnyx assistant. Caller hears continuity within one brand.
- **Internal agents stay invisible**: Blue, Codie, Aussie, Dane, etc. are runtime plumbing. They never get named to external callers. Blue's SMS work surfaces as Alex externally.

**Naming snag flagged:** "Dane" is taken by the internal orchestrator agent. The external persona for David's scheduling needs a different name (Riley / Morgan / Sage as candidates — David to pick).

**Persona opener convention:** neutral by default ("Thanks for calling Ascend Property Management maintenance, this is Alex..."). Persona name revealed on direct ask ("Who am I speaking with?" → "I'm Alex"). No persona-leak in SMS templates without a clear naming cue.

**Today's state:** Alex live (voice + SMS via Blue runtime under the hood). Casey/Samantha/Victoria/Riley not yet built — spin up when triggered by clear signals (volume, brand differentiation, customer-experience issues).

**Cross-PM productization:** When AscendOps spins up for new operators, each gets their own Alex by default + the option to spin up specialists later. Specialists become a paid tier feature.

## Business

### AscendOps Property Management (Primary)
- ~420 doors, Chattanooga/Nashville metro, C/D class residential
- Full-service property management: leasing, maintenance, tenant relations, financials
- David Hunter is the owner — licensed general contractor
- DBH Construction is the in-house GC arm for contracting work

### Dane IQ (Product — In Development)
- AI maintenance director agent + standalone SaaS product (daneiq.com)
- Phase 7 (outbound voice + SMS via Telnyx) — SMS path migrated off Twilio; A2P-Twilio blocker obsoleted
- Infrastructure: Railway + Neon PostgreSQL (Pro tier)
- Components: SMS dispatch, photo intake, work order lifecycle, digital twin
- Frontend: Lovable at dispatch-console.lovable.app
- Backend: emergency-dispatch-middleware-production.up.railway.app

### AscendOps Community (New — April 2026)
- PM AI community born from Deal Maker Chattanooga (Topgolf, April 8)
- Model: Free → $59/mo Starter → $99/mo Builder → $799-1500 DFY install + $99/mo
- Platform: Skool (recommended over Circle)
- Beta: David starting monthly AI calls in Crane
- Proof of concept: AscendOps PM itself (David's 420-door company)
- Software product launch planned once community reaches 50-100 members

### AscendOps Framework (Future)
- CortextOS fork pre-configured for PM companies — future product once community is established

## Team

### Humans
- **David Hunter** — Owner/Founder. Non-technical, licensed GC. Thinks in systems & outcomes. Uses Claude.ai for strategy + Claude Code for execution. Voice input via iPhone talk-to-text — keep responses scannable. Direct but warm, appreciates pushback.
- **Carlos** — In-house tech
- **Bud/KC** — Senior techs
- **Casey** — Crew coordinator

### Vendor Roster (Primary by Trade)
- Plumbing: Stubblefield (primary), PBGS, Kapo
- HVAC: Legacy Heat and Air, Dyer
- Electrical: Rogers
- Appliances: Comfort Appliances
- Handyman: AGS, River City Repairs
- Construction / Punch List: ZJB Construction LLC
- Flooring: CT Flooring Supply House
- In-house: Carlos, Casey (crew lead), Bud/KC (senior)

### Vendor Contact Details
| Vendor | Email | Phone | Trade |
|--------|-------|-------|-------|
| AGS Handyman and Lawncare | unversaw89@gmail.com | (423) 475-0145 | Handyman / Lawn Care |
| Comfort Appliances | homecomfort515@gmail.com | (706) 934-6152 | Appliance Repair |
| CT Flooring Supply House | professionalflooringsupplies@gmail.com | (423) 697-7665 | Flooring |
| DBH Construction | david@noogalabs.com | (678) 815-6005 | Construction / General |
| Dyer HVAC | hvacdyers@gmail.com | (706) 639-7217 | HVAC (Primary) |
| Kapo Mechanical | gregorykapo@gmail.com | (423) 504-1755 | HVAC / Mechanical |
| Legacy Heat and Air Services LLC | angelchavezsamayoa@gmail.com | (423) 617-1210 | HVAC (Backup) |
| PBGS Plumbing | paultbenjamin05662@gmail.com | (706) 572-3439 | Plumbing (Standard) |
| River City Repairs | i4dgators@gmail.com | (423) 320-9099 | General Repairs / Plumbing |
| Rogers Electric Company | rogerselectriccompany@yahoo.com | (423) 619-0367 | Electrical |
| Stubblefield Excavation and Plumbing | servicesbysep@gmail.com | (423) 681-0154 | Plumbing / Sewer (Heavy) |
| ZJB Construction LLC | zachb1855@gmail.com | (205) 936-6026 | Construction / Punch List |

## Technical

### Systems & Integrations
- **Property Meld (Nexus API)** — Primary work order system, 628+ melds synced to Neon every 60s. OAuth2 credentials at `~/.claude/credentials/property-meld-nexus.json`
- **AppFolio** — Accounting/leasing. Session-only access (MFA blocks automation). Credentials at `~/.claude/credentials/appfolio.json`
- **Google Sheets** — Vendor/tenant/property data
- **Telnyx** — Tenant/vendor SMS + voice (Alex front desk persona). Replaced Twilio fleet-wide (locked 2026-05-17 brand-split rule). MMS pipeline live for vendor photo intake (PR #7-#11 cascade).
- ~~**SendGrid** — Dane IQ transactional emails (DNS verified on daneiq.com)~~ — STATUS UNCERTAIN as of 2026-05-23; no recent evidence of active use. Flag for David verification.
- **Unwrangle** — Product search API (HD, Lowes, Ferguson, Ace), trial with 100 credits remaining
- **Cloudflare R2** — Photo storage, bucket: dane-iq-media
- **Railway** — Backend hosting
- **Neon PostgreSQL** — Primary database, Pro tier
- **Playwright MCP** — Browser automation (safe sites: lovable.dev, Railway, daneiq.com)

### Repos & Projects on This Machine
- `~/projects/openclawd-lesson-2-agent-soul` — Previous Dane 2.0 agent (being migrated from)
- `~/cortextos` — cortextOS framework (this repo)
- Obsidian Vault at `~/Documents/AscendOps-Brain` (258 notes) — manual reference only; Obsidian mirroring STOPPED per Memory Architecture Policy (4/18) — agents do NOT auto-sync via MCP anymore

### Credentials
- Property Meld: `~/.claude/credentials/property-meld-nexus.json`
- AppFolio: `~/.claude/credentials/appfolio.json`
- Unwrangle: `~/.claude/credentials/unwrangle.json`
- Cloudflare R2: `~/.claude/credentials/cloudflare-r2.json`

## Key Links

- Dane IQ frontend: dispatch-console.lovable.app
- Dane IQ backend health: emergency-dispatch-middleware-production.up.railway.app/health
- Obsidian vault: ~/Documents/AscendOps-Brain
- Migration runbook: ~/Documents/AscendOps-Brain/07-Infrastructure/migration-backup/MIGRATION-RUNBOOK.md
- Previous agent: ~/projects/openclawd-lesson-2-agent-soul

## Key Decisions & Preferences

- **Autonomy model:** Bug fix → fix + deploy + report. Vendor dispatch → always surface approval first. Email → draft all, batch surface 4x/day. Uncertain → do it and report unless touching money/tenant-vendor comms.
- **External actions:** Never send without draft + approval (emails, messages). Always ask before calendar changes, purchases, deletions.
- **Communication:** Direct but warm, lead with answer, skip fluff, keep scannable for voice input. Casual — sound like real humans.
- **Development:** Push code/merge/deploy is autonomous. Playwright safe on known sites. Bug+deploy = no permission needed.
- **Data:** Private data stays private. Trash > rm. When in doubt, ask.
- **Lockbox codes:** CONFIDENTIAL — agents know the formula but must NEVER share it externally.

## Active Blockers (as of 2026-05-23)

- AppFolio automation blocked by MFA (session-only access for now) — unchanged from prior status
- PM Nexus API write access — partially resolved: cookie-auth path via snapcli now handles writes (work-entries CRUD, schedule, files, project mutations); pure Nexus API write still limited but workaround mature

**Recently resolved (removed from list):**
- ~~A2P campaign stuck in Twilio pipeline (ticket #26101897)~~ — obsoleted by Telnyx migration; voice + SMS + MMS all on Telnyx now

## Previous Agent Archive (Dane 2.0 — Historical Reference Only)

Migration from the previous Dane 2.0 agent completed. The archive at `~/projects/openclawd-lesson-2-agent-soul` is historical reference only — agents do NOT actively read it. Memory, state, tasks, skills, and 194-file people directory all migrated to the current cortextos fleet structure. Path retained for cold-storage lookup if a specific pre-migration artifact is ever needed.

## Memory Architecture Policy (locked 2026-04-18 by David)

**Canonical layer rules — all agents must follow:**

| Data type | Canonical location | NOT in |
|-----------|-------------------|--------|
| Daily operational logs | `cortextos/orgs/ascendops/agents/{agent}/memory/YYYY-MM-DD.md` | Obsidian |
| Agent long-term memory | `cortextos/orgs/ascendops/agents/{agent}/MEMORY.md` | Obsidian |
| Agent bootstrap files | `cortextos/orgs/ascendops/agents/{agent}/` | Obsidian 00-Core |
| Doctrine / SOPs / strategy | Obsidian 02-Projects, 06-Integrations, 07-Infrastructure | agent dirs |
| Lockbox codes | `~/cortextos/orgs/ascendops/secure-local/lockbox-codes.md` (chmod 600) | Everywhere else |
| Credentials | `~/.claude/credentials/` + INVENTORY.md | KB, CMEM, Obsidian |

**KB collection scope:**
- `shared-ascendops` — doctrine only (Obsidian 02-06, knowledge.md, 03-People). No daily logs, no .obsidian/ configs, no openclawd files.
- `agent-{name}` — agent's own MEMORY.md + last 7 daily memory files. Private scope only.

**Obsidian mirroring is STOPPED.** Obsidian 01-Memory per-agent folders are archived, not maintained going forward.

## BLOCKED_WRITE_PATHS (enforced policy — do not write to these)

Agents MUST NOT write files to these paths using Write, Edit, or Bash tools:
- `/Users/davidhunter/Documents/AscendOps-Brain/01-Memory/collie/` — archived, chmod 555
- `/Users/davidhunter/Documents/AscendOps-Brain/01-Memory/blue/` — archived, chmod 555
- `/Users/davidhunter/Documents/AscendOps-Brain/01-Memory/aussie/` — archived, chmod 555
- `/Users/davidhunter/Documents/AscendOps-Brain/01-Memory/daily/` — Dane 2.0 era archive, do not append
- `/Users/davidhunter/cortextos/orgs/ascendops/secure-local/` — read-only by path, never write new files here except by explicit David instruction
- `/Users/davidhunter/.claude/credentials/` — read-only by agents; new entries require explicit authorization

This file (knowledge.md) is chmod 444. Only Dane (memory governor) may chmod 644 to edit, then must chmod 444 to lock again.

## Business Registration Details (A2P / 10DLC filings)

Provided by David 2026-04-19. Use for any carrier registration (Telnyx; previously Twilio path obsoleted):

- **Business address:** 9305 Royal Shadows Dr., Chattanooga, TN 37421
- **Business phone:** +16788156005 (David's cell)
- **Website:** https://danaiq.com
- **Entity type:** LLC
- **Monthly SMS volume estimate:** 500–750
- **Legal company name:** Dane IQ LLC
- **EIN:** 41-2747629
- **Business email:** david@daneiq.com

---

## rtk-ai Organization — Tool Research (2026-04-24)

rtk-ai (https://github.com/rtk-ai) builds AI developer infrastructure in Rust. Three tools are relevant to our fleet:

**rtk** (34.7k stars) — CLI proxy that reduces LLM token consumption 60–90% on shell commands. Hooks into Claude Code via PreToolUse. Zero code changes — install once with `brew install rtk && rtk init`. Immediately valuable for extending agent session life and reducing API costs.

**icm** (241 stars) — Permanent memory for AI agents. MCP-native, SQLite-backed, hybrid BM25+vector search. Two memory types: episodic (time-decaying by importance) and semantic knowledge graph (permanent, no decay). Potential alternative or complement to our current flat-file KB system.

**grit** (42 stars) — Git for AI agents. AST-level (function-level) locking via Tree-sitter prevents merge conflicts when multiple agents edit the same file simultaneously. Relevant when we scale to 3+ parallel dev agents.

**vox** (85 stars) — TTS/STT CLI, Rust, MCP-native. Six backends including macOS native `say` and Qwen. Sub-1-second latency, voice cloning. Low current priority — future path for voice-based tenant calls or David voice commands.

**homebrew-tap** (9 stars) — Package distribution only. How rtk/vox/icm get installed via `brew install`.

Note: David sent `rtk-ai/rt` (404s). Likely typo for `rtk-ai/rtk`. Full research doc at orgs/ascendops/docs/rtk-ai-org-research.md.

Status: rtk v0.37.2 installed 2026-04-24 with global Claude Code PreToolUse hook. Token savings accumulate from next session forward.

**claude-mem** (67k stars) — already installed and running since 2026-04-09. TypeScript/Bun/ChromaDB. Captures all Claude tool use, compresses with Claude SDK, injects relevant context at SessionStart. Powers the $CMEM session context header. 13,259 observations, 277 session summaries as of 2026-04-24. NOT from rtk-ai org (author: thedotmack). Complements icm: claude-mem = automatic session capture; icm = explicit manual memory + knowledge graph.

Recommended priority: rtk (done), then evaluate icm as KB upgrade. vox and grit are future-phase.

---

## Fleet Build Pattern — Execution-Lead-With-Subagents (locked 2026-05-21 by David)

**DEFAULT method for all non-trivial builds across the fleet:**

1. **Execution lead** (Codie for coding/CLI/PR work) spawns 2-3 subagents per task with detailed specs (clear acceptance criteria, single-file scope, testable in isolation)
2. **Subagents execute in parallel** — contexts isolated, don't bleed into main thread
3. **Execution lead self-reviews** subagent output before opening PR
4. **PR opens** → Codex bot reviews automatically
5. **Peer reviewer** (Collie on review duty) reviews the PR
6. **Execution lead merges** when clean OR loops if review surfaces issues

**Parallelism:** independent tasks run concurrently via separate subagent topologies. Total 4-6 subagents in flight is fine. Sequential only when downstream depends on upstream outputs.

**When NOT to use:** trivial scope (<15 min total, single PATCH + verify). Judgment call, lean toward multi when unsure.

**Why this is the default:**
- Multi-layer review (Codex + peer + self) catches more than single-pass
- No context rot for main agent (subagent context isolated)
- Faster throughput via parallelism
- Stays-on-task discipline (new asks spawn new subagents, don't thrash)

**Persisted in:** Codie MEMORY.md (execution lead role), Collie MEMORY.md (reviewer role), Dane MEMORY.md (orchestrator dispatch shape), this knowledge.md (fleet-wide doctrine).

**Drift detection:**
- Collie reviews every Codie PR — flags non-subagent-shape PRs in non-trivial scope
- Dane monitors PR-open events fleet-wide for the pattern
- Bootstrap-on-session-start: agents re-read their MEMORY.md, survives crash/restart

**Refines but does not replace:** 5/17 multi-subagent build pattern (2-3 subagents per build), 5/18 context-first task discipline (one task end-to-end, no thrash), 5/18 protect-dialed-in-agents.

---

## Upstream-Alignment Default — Fleet Rule (locked 2026-05-21 by David)

**When upstream has changes equivalent to ours, DEFAULT to ALIGNING with upstream. Only keep our divergent fork-side version when there is a specific, named reason.**

**Why this is fleet doctrine:** Divergence-debt compounds. Every fork-side custom version makes future upstream-syncs harder. Long-term tech debt grows with every divergence not justified.

**Evaluation per "fork has equivalent" classification:**
1. What upstream is doing
2. What we have
3. Literal diff
4. Why we diverged (intentional or accidental)
5. What could need a second look

**Decision criteria (refined 2026-05-21 by David):**
- Functionally identical → CHURN APPROACH = revert our fork commit + cherry-pick upstream version. Git history becomes the bulletproof alignment record. **This is the default path.**
- Real named reason to diverge → document inline + maintain divergence intentionally
- Revert unsafe (downstream fork dependencies require re-applying) → mapping file (fork-upstream-equivalence-mappings.md) as documented fallback
- Default if unclear → churn

**Why churn beats mapping file:** Maintenance docs require discipline that rots over time. Git history doesn't rot. Future syncs trivially recognize "we use upstream's version" without external docs. 2 commits of net-zero churn TODAY = bulletproof FOR YEARS.

**Application across fleet:**
- Every cherry-pick / upstream-sync batch includes this evaluation pass
- Run during hot-context, not scheduled-for-later
- Pairs with divergence-avoidance pattern (file upstream issue rather than diverge fork for upstream-source bugs)
- Persisted in Codie MEMORY.md, Collie MEMORY.md, Dane MEMORY.md, this knowledge.md

**Trigger:** 2026-05-21 Task 2 cherry-pick batch — Sub A classified "fork has equivalent" on 2 commits, Dane initially accepted the drop, David surfaced the rule. Re-evaluation dispatched same-day while context was hot.
