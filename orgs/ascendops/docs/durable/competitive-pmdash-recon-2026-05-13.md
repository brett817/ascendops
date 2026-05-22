# PMDash Competitive Recon — 2026-05-13

Surface scan of pmdash.io. Single-night recon; landing page schema.org JSON-LD is the highest-density source so this captures most of the public-facing positioning.

## Product

- **Name:** PMDash — Property Management KPI Dashboard
- **Tagline:** "One Scoreboard for Your Whole Stack"
- **Category (self-described):** BusinessApplication, web SaaS
- **Domain:** pmdash.io

## Positioning

Passive observability layer for PM operators. Connects leasing / maintenance / screening / accounting tools into one live KPI dashboard. Custom metrics + AI-generated briefings ride on top. No mention of taking action — read-only by design.

## Pricing

| Tier | Price | Included |
|---|---|---|
| Free trial | $0 | 1 integration, 1 metric, 1 user, full dashboard access, no credit card |
| Paid | $35 / month | Unlimited metrics + boards, AI briefings, all integrations, custom branding, role-based access, team |

No contracts, cancel anytime per FAQ.

## Features (8 named)

1. Custom KPI metric builder — "like building a search filter" against integration data sources
2. AI-generated operational briefings — daily or weekly plain-English summary across all integrations
3. 14+ property management integrations (see list below)
4. Real-time dashboard with severity indicators (yellow / red thresholds per metric)
5. Auto-refreshing TV display mode
6. Role-based access control — 3 permission levels
7. Per-person metric assignments
8. Custom branding and theming
9. (Bonus from FAQ) 149+ pre-built metric templates

## Integrations (14+ explicitly named on site)

- Aptly
- RentVine
- Property Meld
- LeadSimple
- Boom
- RentEngine
- Buildium
- QuickBooks
- Guesty
- ShowMojo
- Monday.com
- Asana
- Custom webhooks: Zapier, Make, n8n

## Security claims

- AES-256-GCM encryption for integration credentials
- Role-based access control (3 permission levels)
- Comprehensive audit logging
- Session management
- Per-org data isolation

## Competitive surface vs AscendOps

| Axis | PMDash | AscendOps |
|---|---|---|
| Product shape | Passive dashboard + AI summary | Active 24/7 agent fleet that does work |
| Action capability | Read-only / observability | Read + write (vendor dispatch, tenant comms, scheduling, drafting) |
| Price anchor | $35/mo flat | Crane tiers $59-$1500/mo + setup |
| PM software coverage | 14+ direct integrations | Property Meld + AppFolio shipped; others via customer-built `cli-anything-*` adapter |
| Setup complexity | Low (OAuth connect, point + click) | Higher (Telegram bots per agent, secrets.env, cred onboarding) |
| AI surface | Daily/weekly summary briefings | Always-on agents with role-specific personas (Maintenance Director, etc.) |
| OS support | Web SaaS (any browser) | Mac confirmed; Linux/Windows pending cross-platform validation |
| Hosting | Their cloud | Customer's machine (local Mac/Linux/VPS) |
| Data residency | Their servers | Customer-controlled |

## Strategic takeaway

PMDash is the **observability half** of the Unified Command Center vision David has been mulling (see `project_unified_command_center_vision`). It is NOT a direct competitor to AscendOps — different product category — but it occupies the dashboard real estate David has imagined building.

Three plausible directions:

1. **Compete on the dashboard layer.** Build the KPI scoreboard into AscendOps dashboard, ship as a unified observability + action product. Harder, more development work.
2. **Coexist / integrate.** Position AscendOps as the action layer that sits next to PMDash's observability layer. Customer runs PMDash for KPIs, AscendOps for agents. Lower friction; some customer overlap on integrations (both read Property Meld etc.).
3. **Outrun the metric layer.** Skip dashboards entirely. Position AscendOps purely on "AI teammates that DO the work" — let PMDash and similar own the scoreboard mindshare while AscendOps captures the action mindshare.

David's "AI-First Maintenance Coordination Workflow" calendar event tomorrow at 3pm ET is likely on this same conceptual axis. The talk content + the pmdash positioning are converging on the same Crane audience.

## Open questions for David

- Is the Unified Command Center vision still active or shelved? If active, the dashboard buildout becomes a real cost item.
- Has anyone in Crane already used PMDash? Worth asking the community before deciding whether to compete or coexist.
- $35/mo flat is a deflationary anchor. If AscendOps customers see PMDash as "the dashboard problem" already solved cheaply, they may resist paying for it inside AscendOps. Argues for direction 2 or 3.

## Limitations of this recon

- Single landing-page scan; deeper pages (features, pricing) require JS-rendered fetch via Playwright that was not run tonight
- Public schema.org JSON-LD is rich (most of what's above came from there) but doesn't reveal back-end architecture, customer count, runtime stability, or actual quality of the AI briefings
- No customer testimonials / case studies surfaced in the scan — either intentional or just not on the homepage
- Pricing claim of "free trial" + "$35/mo" is taken at face value from the site; not validated against actual signup flow
