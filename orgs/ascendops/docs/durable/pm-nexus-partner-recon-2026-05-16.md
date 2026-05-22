# PM Nexus Partner Program — Public Recon

**Captured:** 2026-05-16 by Aussie for David's Mon 5/25 5pm EDT call with Property Meld CEO Ray Hespen + VP Data/Eng Erin Karam + Clara Hart.

**Purpose:** Source-cited public info on Property Meld's partner programs, to inform AscendOps positioning for a Nexus Partner listing.

**Smoke-evidence-bar note:** Every fact below is sourced from a specific publicly-accessible Property Meld page (URLs cited inline). Where the public surface does not disclose a detail (application flow, pricing, revenue share), that gap is flagged explicitly rather than inferred.

---

## 1. The two "Nexus" brands

Property Meld uses the **Nexus** brand twice with different meanings — important not to conflate:

- **Partner Nexus** — software-integration program. Connects Property Meld with other vendor software (accounting, inspection, etc.). Branded on the [integration-partners page](https://propertymeld.com/property-meld-integration-partners/). This is the program AscendOps would apply to.
- **Vendor Nexus** — vendor-sourcing platform. Connects property managers with pre-screened maintenance vendors (contractors, technicians). Branded on the [vendor-nexus page](https://propertymeld.com/vendor-nexus/). 81% U.S. coverage claim. Not relevant to AscendOps positioning.

Reference for AscendOps Mon call: when David says "Nexus partner program," ensure context clarifies he means the SOFTWARE-INTEGRATION track, not the vendor-sourcing track.

---

## 2. Current Partner Nexus integration roster

Source: https://propertymeld.com/property-meld-integration-partners/

**Accounting / Property Management Software (6 partners):**
- AppFolio
- Buildium
- Rent Manager
- Propertyware
- Yardi Voyager
- Rentvine

**Maintenance-focused (1 partner + 1 placeholder):**
- zInspector — inspection solutions
- "Coming Soon" — placeholder for next maintenance-focused integration

**Total listed: 7 partners + 1 placeholder.**

Notable absence: no AI-agent, no operations-automation, no AI-copilot partner currently listed. AscendOps would be the first in that category.

---

## 3. Pricing / commercial terms (what's disclosed)

Quote from the integration-partners page:

> "Property Meld doesn't charge extra for our integrations."

That's the only public commercial statement. **No revenue share is disclosed.** **No partner application fee is disclosed.** **No technical integration cost is disclosed.**

---

## 4. Application / signup flow (GAP)

**Public surface discloses nothing on how to apply.** No form, no email contact, no developer portal, no API docs link. The integration-partners page is purely a listing page — operator-facing, not partner-facing.

Property Meld has a developer-facing surface ("Nexus API" — confirmed via working OAuth2 client-credentials flow against `app.propertymeld.com/api/v2/`), but the customer-self-serve onboarding flow for that API is the standard "open a support ticket" path. There is no public partner-marketing page that says "apply here to be listed."

**This is THE primary ask for the Monday call.** Without a public application surface, the path to a listing is necessarily a direct conversation with PM leadership.

---

## 5. Adjacent program — Advocacy Program (NOT the partner program)

Source: https://propertymeld.com/property-meld-advocacy-program/

Property Meld runs an **Advocacy Program** that rewards CUSTOMERS who refer other customers. Two tracks:

- **Meld Masters** (customer advocates): $2 per unit kickback for new customer referrals, plus early platform access.
- **Vendors**: $20 to Mike Rowe Works Foundation per referral connection; embroidered Carhartt jacket on first successful referral; Snap-On gift cards ($50-$100) for subsequent referrals.

This is a referral/word-of-mouth program — not a software-integration partnership. **Distinct from Partner Nexus.** Not the right ask for the Monday call (unless David also wants AscendOps to participate as a customer-side advocate, which is a much smaller positioning).

---

## 6. Adjacent surface — Club Meld

Source: https://club-meld.com/

Property Meld customer education hub. Webinars, help articles, downloadable resources. **No partner application angle.** Not relevant to the Monday ask.

---

## 7. What to push on during the Monday call

Based on the public-surface gap analysis, the productive asks are:

1. **What is the application bar to be listed as a Partner Nexus integration?** (No public answer exists.)
2. **What technical integration model do PM partners follow?** OAuth2 client-credentials against the Nexus API is confirmed working (we have it live in AscendOps). Are there shape requirements — e.g. must consume specific endpoints, must follow specific data semantics?
3. **Is there a revenue-share model with partners, or is "we don't charge extra" mutual?** Pricing direction matters for AscendOps commercial planning.
4. **What's the timeline expectation between "applied" and "listed"?** Useful for ship planning.
5. **Is "AI maintenance copilot" a category PM is actively recruiting for, or is the partner roster opportunistic?** The roster's accounting-heavy lineup + 1 inspection partner + 1 placeholder suggests no active recruiting in the AscendOps category — meaning AscendOps could be PM's anchor partner in that category if positioned right.

---

## Sources

- https://propertymeld.com/ — root site
- https://propertymeld.com/property-meld-integration-partners/ — integration roster
- https://propertymeld.com/vendor-nexus/ — distinct vendor-sourcing platform
- https://propertymeld.com/property-meld-advocacy-program/ — referral program
- https://club-meld.com/ — customer education hub
