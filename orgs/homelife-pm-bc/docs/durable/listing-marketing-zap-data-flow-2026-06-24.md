# Listing Marketing: Current Zapier/LeadSimple Data Flow

Source: exported Zap JSONs from Brett, 2026-06-24 (Zapier Pro plan, per-zap export is available on any plan — corrects an earlier wrong assumption that this needed Team/Enterprise). Structural analysis only (step types, apps, branch logic, field schemas) — no PII or literal field values pulled from the exports.

## Zap 1: "LeadSimple Inbox Management" (80 steps)

**Trigger:** `inbound_conversation_created` (LeadSimple) — fires on every new inbound conversation/email into LeadSimple's inbox.

**Top-level branch (step 2), 7 paths by conversation type:**

| Path | What happens |
|---|---|
| SeeVirtual Stats Email | Tag conversation, update conversation (steps 53→54 branch into 4 sub-paths: Stats, Media, Floor Plan, Links — each tags the conversation; Media path additionally runs AI extraction → finds the matching Buildium-synced Owner Lead in LeadSimple → finds/creates the property's Advertising/Photos Drive folders → uploads photo zip → unzips → loops files → uploads each to Drive **and** WordPress media library → finds the unit → tags it with the SeeVirtual Tour ID) |
| Realtor.ca Lead | Search Gmail message → convert HTML to Markdown → AI-extract address/lead details → add to Mailchimp → find matching LeadSimple Deal → branch: create Tenant Lead (search for existing first, only create if none exists, then update lead with property/unit IDs) **or** send email + update conversation (sub-branch on whether a Buildium Rental Owner Lead was found: if found, finds the PM-specific Drive folder, delays, sends reply CC'ing the property manager; if not found, finds a general Drive folder, delays, sends a generic reply) → generates fallback phone/last name/date if blank → **calls a sub-zap to push the lead to Rhenti** (step 48: account_id, zap_id, howDidYouHear, email, firstName, lastName, phone, propertyId, moveInDate, monthlyBudget). *Sub-zap content not yet pulled — Brett asked separately for that export.*
| Rentometer | Find user, assign conversation, close it |
| Initial Schedule A | AI step ("Analyze Email and Return Data") → branch on whether the lead-owner email exists or not → either find the matching Deal and assign/close, or find the matching user and assign/close |
| Bark | Update conversation only |
| Unidentified Direct Caller | Delay, then (falls through to other handling) |
| Realtor.ca Listing Live | Tag conversation, update conversation |

**External systems touched:** LeadSimple (conversations, deals/leads, users, units — read+write throughout), Google Drive (find/create folders, upload photos + floor plan PDFs), WordPress (media library uploads), Gmail (search inbound mail, send replies), Mailchimp (add lead as list member), an AI completion step (used 3x: parse/classify inbound email, extract address + lead details twice), Rhenti (via the sub-zap call at step 48, lead handoff only).

**Note on Buildium:** this zap never calls Buildium's API directly. "Buildium Rental Owner Lead Found/NOT Found" branches are checking LeadSimple's own Owner Lead records, which LeadSimple syncs in from Buildium separately (LeadSimple has its own direct Buildium integration, outside this zap).

## Zap 2: "New Listing Marketing - Write Up" (27 steps)

**Trigger:** `process_created` (LeadSimple) — fires when the "New Listing Marketing - Write Up" process is kicked off on a lead/property.

**Flow:**
1. Filter → format a value → AI completion step (purpose: validates/transforms a property-manager-email-typed field per its schema, exact instructions not pulled)
2. Look up a Drive file/folder by ID → branch on **Success / Error**
   - **Error path:** email alert → **request_approval** step (Zapier's human-in-the-loop approval action: approve/reject labels, configurable reviewer, timeout + reminder, denied-action behavior) → then re-finds the property → finds the Advertising folder → checks if the write-up doc already exists → if it **doesn't exist**: creates it from a Google Docs template, emails, shares the file, logs a process note back in LeadSimple, delays
   - **Success path:** same shape (find/create Advertising folder → check if doc exists → if not, create from template → email → share → log process note), without the approval step in front
3. **Google Doc template fields populated:** street address, city, province, postal code, property type, available date, square footage, beds, baths, dens, starting rent rate — i.e. the structured property facts. **No marketing description/copy field exists in this template today.**

**External systems touched:** LeadSimple (process trigger, property lookup, process notes), Google Drive (folder/file lookup, template-based doc creation, sharing), Gmail (notification emails), an AI completion step (validation only, not content generation).

## Concrete feature idea (Brett, 2026-06-24)

Brett wants an AI research/draft step that writes the marketing description for the property, with the PM reviewing/approving before it's used — replacing "PM writes it from scratch." This is a genuinely new capability relative to today's process: the current write-up zap only populates structured facts into the template, it does not generate any descriptive copy. The approval-step pattern (request_approval, used today for the error-path alert) already exists in their Zapier toolkit and could be reused for the PM-approves-AI-draft step.

## Still pending

- "Push to Rhenti" sub-zap (referenced at step 48 of Zap 1) — Brett asked separately, not yet exported/analyzed.
- Realtor.ca listing-live and MLS/Paragon syndication mechanics are not visible in either zap pulled so far.
