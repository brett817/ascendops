# Software Integration Standard
**Version:** 1.0  
**Effective:** 2026-04-19  
**Authority:** David Hunter (AscendOps)  
**Enforced by:** Dane (orchestrator)

---

## Purpose

No new software, portal, or operational platform may be adopted into agent workflows until this standard is completed and approved by David. This gate ensures every integration has a defined access method, memory architecture, constraint map, and fallback path before agents rely on it operationally.

---

## Required Before Adoption

### 1. Identity
- [ ] Software name
- [ ] Business purpose (what operational need it serves)
- [ ] Owner / primary user at AscendOps

### 2. Access Method
- [ ] Does it have an API? (yes / no / partial)
- [ ] Does it require browser or desktop automation? (yes / no)
- [ ] Does it require MFA or session-based auth? (yes / no — if yes, describe method)
- [ ] Does access require a human login step that agents cannot replicate? (yes / no)

### 3. Canonical Data
- [ ] What information from this system is considered canonical truth?
- [ ] How often does it change (real-time / daily / weekly / rarely)?
- [ ] Who is responsible for keeping it accurate?

### 4. Memory Architecture
- [ ] **Doctrine** (stable facts, rarely change): stored where?
- [ ] **Retrieval knowledge** (queryable context): stored where in KB?
- [ ] **Operational truth** (live state, changes frequently): stored where?
- [ ] **Sensitive data** (credentials, PII, financial): stored where and with what access controls?

### 5. Automations Allowed
- [ ] What read operations are agents permitted to perform autonomously?
- [ ] What write/action operations are agents permitted autonomously?
- [ ] What operations always require David approval before execution?

### 6. Constraints
- [ ] Rate limits (API calls per minute/hour/day)
- [ ] Session expiry behavior
- [ ] MFA re-authentication frequency
- [ ] Known failure modes or brittleness

### 7. Rollback and Fallback
- [ ] If this software changes its API or interface, what is the fallback?
- [ ] If access is lost, what manual process does it replace?
- [ ] Who is the escalation contact at the vendor?

---

## Approval Process

1. Dane reviews completed integration standard
2. Dane sends summary to David via Telegram with recommendation (adopt / watchlist / skip)
3. David approves or rejects
4. Only after explicit David approval: agents may begin using the integration operationally

---

## Template

```
Software Name: 
Business Purpose: 
Owner at AscendOps: 

## Access
Has API: 
Browser/desktop automation required: 
MFA or session auth: 
Human login required: 

## Canonical Data
What is canonical: 
Change frequency: 
Responsible for accuracy: 

## Memory Architecture
Doctrine stored at: 
Retrieval knowledge (KB collection): 
Operational truth stored at: 
Sensitive data stored at: 
Sensitive data access controls: 

## Automations Allowed
Autonomous reads: 
Autonomous writes/actions: 
Always requires David approval: 

## Constraints
Rate limits: 
Session expiry: 
MFA re-auth frequency: 
Known failure modes: 

## Rollback and Fallback
API change fallback: 
Access loss fallback: 
Vendor escalation contact: 

## Approval
Reviewed by Dane: 
Approved by David: 
Adoption date: 
```

---

## Reference — Current Integrations

| Software | API | Auth | Canonical Data | Status |
|----------|-----|------|---------------|--------|
| PropertyMeld | Yes (Nexus) | API key | Meld status, vendor assignments | Active |
| AppFolio | No (MFA blocks) | Session headers | Work orders, tenant records | Shallow doctrine |
| Monday.com | Yes | API key | Turnover board, project tracking | Active |
| Telnyx | Yes | API key | SMS/voice delivery, number registry | Active |
| Google Workspace | CLI | OAuth | Email, calendar, drive | Active |
| Railway | Dashboard + CLI | Token | Deployment state, env vars | Active |
| Neon | Postgres | Connection string | CMEM observations, usage_daily | Active |
| Cloudflare | Tunnel CLI | Zero Trust | blue-relay tunnel URL | Active |
