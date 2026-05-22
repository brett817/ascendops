# Multi-Model Vendor Matrix — capabilities + pricing

**Status:** Skeleton, awaiting first vendor adapter implementation
**Refresh cadence:** quarterly (or whenever a vendor ships a major-version model)
**Companion:** [rfc-multi-model-platform.md](./rfc-multi-model-platform.md) (Thursday plate item #3)
**Last updated:** 2026-04-29 (skeleton, no live data yet)

---

## Read me first

This file is the **operational source of truth** for which vendor + model each cortextos agent picks. The RFC defines the architecture; this file defines the choices that follow from it.

Three rules for editing:
1. **Never invent pricing.** Cells without a verified source link → mark `OPEN — verify`. Drift > 1 quarter → re-flag as `OPEN`.
2. **Capability cells use `✓ / ✗ / partial / OPEN`** — not freeform. `partial` requires a parenthesized note.
3. **Every row of pricing must include a source URL + a date stamp.** Stale source = `OPEN — re-verify`.

---

## 1. Capability matrix

Granularity: per vendor. Per-model variants noted only where they meaningfully differ (e.g. Anthropic Haiku ≠ Opus on extended thinking budget).

| Capability | Anthropic | OpenAI | Google | xAI |
|---|---|---|---|---|
| Native prompt cache | ✓ | OPEN — verify GPT-5.5 cache semantics | ✗ (synth via cached-content API, ≥32k cache target) | ✗ |
| Extended thinking / reasoning | ✓ (budget int, e.g. 5M tok) | ✓ (effort tier: none/minimal/low/medium/high/xhigh) | ✓ (`thinking_config` mode) | OPEN |
| Tool use / function calling | ✓ (Anthropic tool JSON) | ✓ (function_call JSON) | ✓ (function_declarations) | partial (narrower ecosystem) |
| Streaming | ✓ | ✓ | ✓ (streamGenerateContent) | ✓ (SSE) |
| Vision (image in) | ✓ | ✓ | ✓ | partial (image-understanding only on some models) |
| Audio in/out | partial (in only via Realtime API workaround) | ✓ (Realtime API, both directions) | ✓ (Multimodal Live) | ✗ |
| Max input context | 200k | OPEN — GPT-5.5 reported 400k, verify | 2M (Gemini 2.5 Pro) | 128k (Grok-3) |
| Max output tokens | 8k (Opus, Sonnet) | ~16k (verify GPT-5.5) | 8k | 8k |
| CLI binary available | ✓ `claude` | ✓ `codex` | ✓ `gemini` (or `gcloud ai`) | ✗ (HTTP-only adapter) |
| Persistent multi-turn session | ✓ (`--continue`) | ✓ (`--resume-last`) | OPEN — verify Gemini CLI session model | n/a (HTTP, adapter-managed) |
| Skip-permissions / write-by-default | ✓ (`--dangerously-skip-permissions`) | ✓ (`--write`, sandbox-by-default) | OPEN | n/a |
| Native structured output (JSON mode) | partial (via tool use) | ✓ | ✓ | OPEN |
| Webhook / async tasks | ✗ | ✓ (codex cloud tasks) | ✗ | ✗ |

Notes:
- "Native" prompt cache means the vendor charges a discounted rate for cache hits and the cache is managed inside the inference API. Synthesized caches via separate APIs (Gemini's cached-content) cost effort but win on long prefixes.
- Tool-format columns are *what the wire format looks like*; the cortextos adapter normalizes to one internal shape (open question in RFC §9 — Anthropic JSON vs OpenAI function-call as the standard).

## 2. Pricing matrix

**All cells: OPEN until first adapter ships and we verify against live vendor pricing pages.**

Schema: `cost_per_mtok_in` / `cost_per_mtok_out` (USD per 1M tokens). Cache hit / cache write split where the vendor distinguishes.

### 2.1 Anthropic

| Model | Input $/Mtok | Output $/Mtok | Cache hit $/Mtok | Cache write $/Mtok | Source | Verified |
|---|---|---|---|---|---|---|
| claude-opus-4-7 | OPEN | OPEN | OPEN | OPEN | https://www.anthropic.com/pricing | OPEN |
| claude-sonnet-4-6 | OPEN | OPEN | OPEN | OPEN | https://www.anthropic.com/pricing | OPEN |
| claude-haiku-4-5-20251001 | OPEN | OPEN | OPEN | OPEN | https://www.anthropic.com/pricing | OPEN |

### 2.2 OpenAI

| Model | Input $/Mtok | Output $/Mtok | Cached input $/Mtok | Source | Verified |
|---|---|---|---|---|---|
| gpt-5.5 | OPEN | OPEN | OPEN | https://openai.com/api/pricing | OPEN |
| gpt-5.3-codex-spark | OPEN | OPEN | OPEN | https://openai.com/api/pricing | OPEN |

### 2.3 Google Gemini

| Model | Input $/Mtok | Output $/Mtok | Cached content $/Mtok-hr | Source | Verified |
|---|---|---|---|---|---|
| gemini-2.5-pro | OPEN | OPEN | OPEN | https://ai.google.dev/pricing | OPEN |
| gemini-2.5-flash | OPEN | OPEN | OPEN | https://ai.google.dev/pricing | OPEN |

### 2.4 xAI

| Model | Tier | Input $/Mtok | Output $/Mtok | Source | Verified |
|---|---|---|---|---|---|
| grok-3 | OPEN (subscription tier or per-token, verify) | OPEN | OPEN | https://x.ai/api | OPEN |

## 3. Workload-based decision matrix

Reference workload: Dane orchestrator, ~80k input + 10k output per active day, ~12 active days/month → ~1M input + ~120k output / month.

| Workload class | Recommended vendor | Reason |
|---|---|---|
| Orchestrator (Dane) — high-context, low-creativity | OPEN — depends on Gemini 2M ctx pricing vs Anthropic cache savings | Bootstrap fits in single context window if Gemini cheap enough |
| Specialist chat (Blue) — user-facing, latency-sensitive | Anthropic | Cache savings on conversation history; lowest TTFT |
| Specialist research (Aussie) — long-form synthesis | OpenAI or Gemini | Both have larger output windows than Claude (16k vs 8k) |
| Specialist code (Codex-style — none today) | OpenAI | codex CLI already integrated; spark for cheap iterations |
| Cron-fired daily skills | Cheapest verified per-token (likely Gemini Flash or Haiku) | Stateless, throughput-tolerant |

This matrix is **advisory** — final per-agent vendor stays in `config.json`. Override the matrix when an agent has unusual requirements (e.g. Blue needs vision for meld photos → must pick a vision-capable vendor).

## 4. Update protocol

When a vendor ships a new model or pricing changes:

1. Edit the affected row(s) in §1 / §2.
2. Update the `Verified` column with today's date.
3. Update `Source` URL only if the vendor moved their pricing page.
4. Re-run the workload comparison in §3 if the change is >10% on cost or >1 capability tier.
5. Bump `Last updated` at the top.

When a row goes stale (>1 quarter since `Verified`):
- Mark `Verified` cell as `OPEN — re-verify`.
- Do NOT clear the dollar values; treat them as last-known-good until re-verified.

When a new vendor enters the platform:
- Add a column to §1, a §2.X subsection, and rows in §3.
- File a follow-up RFC if the new vendor changes the adapter interface.

## 5. Open items tracked here (not in the RFC)

- [ ] First-pass pricing fill — must verify all `OPEN` cells before any vendor adapter ships.
- [ ] Decision: standardize internal tool-format on Anthropic JSON or OpenAI function-call (RFC §9 Q3).
- [ ] Decision: include xAI in MVP or defer (RFC §9 Q1).
- [ ] Build `cortextos pricing refresh` weekly job (RFC §9 Q4) — depends on each vendor exposing a stable pricing endpoint, currently mostly HTML scraping.
- [ ] Capability re-verification for Gemini 2.5 thinking-mode + structured-output as of writing.
