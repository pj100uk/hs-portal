# CLAUDE.md — HS Portal Architectural Reference

This file exists to prevent recurring confusion about non-obvious design decisions, past bugs, and architectural invariants. Read it before touching any shared logic. Update it when you discover something that would have saved time if you'd known it earlier.

---

## 1. Project Overview

Health & Safety compliance portal for UK clients managed by MBHS (the advisor company).
- **Stack:** Next.js 14 App Router · Supabase (PostgreSQL + Storage) · Datto Workplace (document store) · Google Cloud (Gemini AI + Cloud Function)
- **Runtime:** All API routes use `export const runtime = 'nodejs'` (not Edge)
- **Roles:** `superadmin` · `advisor` · `client` (set in `profiles.role`)
- **Main UI file:** `app/page.tsx` (~8,000+ lines, single file — split when performance work begins)

---

## 2. CRITICAL INVARIANTS — Read This First

These are the most important architectural facts. They have caused serious bugs and confusion when forgotten.

### 2a. Two action tracks — `site_document_id` vs `source_document_id`

`actions` has two separate UUID/text fields that look confusingly similar but mean completely different things:

| Field | Type | Meaning | Shown in advisor panel? |
|---|---|---|---|
| `site_document_id` | `uuid` | Action extracted from a **client-uploaded** `site_documents` record | **NO** |
| `source_document_id` | `text` | Datto file ID of the **MBHS-managed** document the action came from | **YES** |

**Actions with `site_document_id IS NOT NULL` are client-doc actions and must be excluded everywhere:**
- Advisor actions panel: `.is('site_document_id', null)`
- AI sync (`sync-site.ts`): `.is('site_document_id', null)`
- Recalc route (`app/api/actions/recalc/route.ts`): `.is('site_document_id', null)`
- Report (`app/report/page.tsx`): `.is('site_document_id', null)`

This filter appears in at least 5 places. If you add a new query over `actions` that should only show MBHS-managed actions, add this filter.

**Why this exists:** Client-uploaded documents are scanned for actions by AI, but those actions belong entirely to the client — they don't appear in the main advisor action register, don't affect compliance scoring, and aren't included in reports.

### 2b. Risk rating must come from the actions table, never Gemini inference

`actions.risk_rating` is set exclusively by parsing the **action plan table** in the Word document (via `app/api/datto/file/readactions/route.ts`). Gemini must never infer or set `risk_rating` — it caused non-deterministic flip-flopping between risk levels in early versions.

- `risk_level` (high/medium/low) is always derived from `risk_rating` via `normaliseRiskLevel()` — never set directly by Gemini
- The correct risk rating is in the **actions table** near the end of the Word doc, not in the hazard register columns

### 2c. `is_suggested` flag on actions

`actions.is_suggested = true` means the action was AI-extracted but not yet accepted by an advisor. These are shown in the AI Suggestions panel, not the main actions list. Always check whether a query should include or exclude suggested actions.

### 2d. `client_provided` flag on site_documents

`site_documents.client_provided = true` → document was uploaded by the client; shown in "Client Managed Documents" section.  
`site_documents.client_provided = false` → document is managed by MBHS/advisor.

These use different colour schemes in the UI (amber = client, indigo/slate = MBHS).

---

## 3. Database Schema

All 18 tables as of 2026-05-28. Key columns and non-obvious notes included.

### `actions`
Core table — actions extracted from H&S documents.

| Column | Notes |
|---|---|
| `site_document_id` uuid | Non-null = extracted from client-uploaded doc. Exclude from advisor panel. |
| `source_document_id` text | Datto file ID of the source doc (MBHS-managed). NOT a UUID. |
| `source_document_name` text | Display name of the source doc |
| `source_folder_id` text | Datto folder ID (for Evidence subfolder resolution) |
| `source_folder_path` text | Relative path within W:\Customer Documents (for W: drive writes) |
| `hazard_ref` text | Numbered ref from hazard register (e.g. "1", "2a") |
| `hazard` text | Hazard description from hazard register |
| `existing_controls` text | Existing controls from hazard register |
| `risk_rating` text | From Word action table ONLY. Never from Gemini. |
| `risk_level` text | Derived from risk_rating via normaliseRiskLevel() |
| `is_suggested` bool | true = AI suggestion not yet accepted by advisor |
| `extraction_version` int4 | Incremented on re-extraction |
| `review_note` text | Advisor note on the action |
| `resolved_date` date | When action was completed |
| `responsible_person` text | From Word doc, two-way synced |

### `action_evidence`
Files formally linked to an action (evidence of completion).

| Column | Notes |
|---|---|
| `storage_path` text | Path in `client-uploads` Supabase Storage bucket. May be `'pending'` briefly on insert. |
| `datto_file_id` text | Datto file ID after upload to Evidence subfolder |
| `hazard_ref` text | Copied from parent action |
| `source_document_id` text | Copied from parent action |

**Naming convention:** `{DocumentName}-Ref {HazardRef}-EV{n} DD-MM-YY.ext`  
**Storage path:** `evidence/{actionId}/{evidenceId}/{canonicalName}` in `client-uploads` bucket.  
This applies for both direct evidence uploads AND client_uploads linked by advisor.

### `client_uploads`
General evidence files uploaded by clients for advisor review (before being linked to an action).

| Column | Notes |
|---|---|
| `status` text | `pending_review` → `acknowledged` or `linked` |
| `action_id` uuid | Set when advisor links to an action |
| `action_evidence_id` uuid | Set when linked; points to the action_evidence row created |
| `hidden` bool | Soft-hide by advisor (not delete); `includeHidden=true` param to fetch |
| `storage_path` text | `general-uploads/{uploadId}/{filename}` until linked, then moved to `evidence/` path |
| `datto_file_id` text | File ID after upload to Datto "Client Provided Documents" folder |

When an advisor **links** a client_upload to an action:
1. `action_evidence` row is inserted with canonical name
2. File is copied from `general-uploads/` to `evidence/` path in Supabase Storage
3. Original `general-uploads/` file is deleted
4. File is moved in Datto from "Client Provided Documents" → "Evidence" subfolder

### `site_documents`
AI-scanned documents — either uploaded by client or managed by MBHS.

| Column | Notes |
|---|---|
| `client_provided` bool | true = client-owned, shown in amber "Client Managed Documents" section |
| `datto_file_id` text | Datto file ID |
| `datto_folder_id` text | Datto folder ID |
| `extraction_version` int4 | Incremented on AI re-extraction |
| `expiry_date` date | Used for Documentation Health scoring |

### `sites`

| Column | Notes |
|---|---|
| `datto_folder_id` int8 | Datto root folder ID for this site |
| `datto_folder_path` text | Relative path within W:\Customer Documents (no leading slash) |
| `datto_parent_folder_id` text | Parent Datto folder ID |
| `vault_folder_id` text | Datto Vault folder ID (if applicable) |
| `excluded_datto_folder_ids` text[] | Datto subfolder IDs to skip during AI sync |
| `included_datto_folder_ids` text[] | If set, only sync these Datto folder IDs |
| `last_ai_sync` timestamptz | Used by incremental sync to skip unchanged docs |
| `compliance_score` int4 | Documentation Health score (0–100) |
| `iag_score` int4 | Industry Alignment score (0–100) |
| `iag_weighted_score` int4 | Weighted variant |
| `action_progress` int4 | Implementation Score (0–100) |

### `profiles`
One row per auth user.

| Column | Notes |
|---|---|
| `role` text | `superadmin` / `advisor` / `client` |
| `site_id` uuid | For client users assigned to a single site |
| `organisation_id` uuid | Org the user belongs to |
| `view_only` bool | Client user with read-only access |
| `datto_workplace_user` text | Datto Workplace username for this user (used to attribute Datto actions) |
| `datto_base_path` text | Per-user Datto base path override (if advisor manages a sub-tree) |

### `document_health`
Tracks per-site document review due dates independently of `site_documents`.

| Column | Notes |
|---|---|
| `document_name` text | Name of the document to review |
| `review_due` date | When the document is next due for review |

Used for advisory alerts about upcoming document reviews. Separate from `site_documents.expiry_date` (which drives compliance scoring).

### `sync_log`
One row per AI sync run. `site_results` JSONB = per-site breakdown. `errors` JSONB = error list.

### `site_type_requirements`
Global requirements per site type (e.g. WAREHOUSE, OFFICE). Managed by superadmin only.  
`is_mandatory = true` → any site of that type with `purchased = false` in `site_services` → IAG score forced Red.

### `ai_usage_log`
Token and cost tracking per AI call. Used in superadmin usage dashboard.

---

## 4. Datto Integration

### W: drive (primary path)
- Mount: `W:\Customer Documents`
- All writes first try the W: drive using `fs.writeFileSync` / `fs.mkdirSync`
- Site-relative path: `W:\Customer Documents\{site.datto_folder_path}\{subfolder}\{filename}`
- After writing, poll Datto API up to 5× (1s intervals) to get the `datto_file_id` (Datto takes time to sync drive writes)

### Datto REST API (fallback)
- Base URL: `https://eu.workplace.datto.com/2/api/v1` (`BASE_URL` in `folder-utils.ts`)
- Auth: Basic auth (`AUTH_HEADER` in `folder-utils.ts`)
- Used when W: drive is not accessible (`fs.existsSync(DATTO_DRIVE_ROOT)` returns false)
- Upload: `POST /file/{folderId}/files` with `FormData` (`partData` + `fileName` + `makeUnique=true`)
- File IDs: response body has `fileID`, `fileId`, or `id` — always try all three: `d.fileID ?? d.fileId ?? d.id`
- All fetch calls must have `cache: 'no-store'`

### Rate limiting
- 429 response includes `X-Rate-Limit-Retry-After-Seconds` header
- Retry-with-backoff is implemented in `sync-site.ts`; respect the header value
- Batch document processing to avoid hitting limits during bulk sync

### Key folder utilities
`app/api/datto/folder-utils.ts`:
- `BASE_URL`, `AUTH_HEADER` — auth constants
- `resolveClientDocsFolderId(parentId)` — finds/creates "Client Provided Documents" subfolder
- `resolveSubfolder(parentId, name)` — finds/creates any named subfolder
- `resolveEvidenceFolderId(parentId)` — finds/creates "Evidence" subfolder

---

## 5. AI Sync Architecture

### Two separate systems

| | Cloud Function | In-app Sync button |
|---|---|---|
| What | Keeps Gemini Files API fresh | Extracts actions from docs into Supabase |
| Trigger | Cloud Scheduler every 12h | User click |
| Change detection | md5 hash comparison | `last_ai_sync` timestamp |
| Output | Fresh files in Gemini | Actions in `actions` table |

### Cloud Function
- **Why it exists:** Gemini Files API has a 48-hour TTL — without regular re-uploads, Gemini can no longer access the file and sync fails. The Cloud Function re-uploads only changed or soon-to-expire files (md5-based change detection, 24h TTL guard).
- Name: `datto-gemini-sync`, deployed to `europe-west1`, GCP project `gen-lang-client-0874436556`
- Code: `E:\hs-portal\cloud_function\` (main.py, requirements.txt, deploy.sh)
- State stored in GCS bucket `hs-portal-sync-state` → `datto_sync_state.json`
- Manual trigger: `gcloud scheduler jobs run datto-gemini-sync-scheduler --location=europe-west1`
- Logs: `gcloud functions logs read datto-gemini-sync --region=europe-west1 --gen2 --limit=50`

### In-app sync (`sync-site.ts`)
- Uses `mammoth.convertToHtml` (not raw text) to preserve table structure
- `temperature: 0` for deterministic Gemini results
- Appends `Sync-ID: {timestamp}` to every prompt to prevent response caching
- Duplicate detection: same doc + same hazardRef, OR same doc + exact text, OR >80% text similarity
- Re-fetches all actions from Supabase at start of each sync (not stale state)

### Two-way sync
- `readactions` route (`app/api/datto/file/readactions/route.ts`) parses Word XML directly (no Gemini)
- Syncs: action text, responsible person, due date, completed date from Word → portal
- `rowPairingMap` (`Map<portalActionId, WordRow>`): computed **once** per document before both the `aiUpdates` block and the two-way sync block. Both blocks share this map — they do not recompute it independently.
- **Why this matters:** `aiUpdates` runs first and updates portal action texts. If each block built its own pairing, `aiUpdates` would text-match against stale DB texts (pre-update) and pair the wrong portal action to the wrong Word row — causing risk ratings and dates to be applied to the wrong actions.
- `readRowsByRef` stores all Word rows per hazardRef (multiple rows per ref are supported). `bestReadRow()` picks the best match: exact text → substring → positional. Each Word row is "claimed" once and cannot be reused.
- UK dates: `ukToIso()` converts DD/MM/YY and DD/MM/YYYY to ISO format

---

## 6. Scoring System (Three Cards)

All scores stored on `sites` table. Recalc triggered after action status changes.

### Card 1: Implementation Score (`action_progress`)
Weighted by urgency: critical/red = 10pts, upcoming/amber = 5pts, scheduled/green = 1pt.  
Penalties: overdue ×2, critical with no due date ×1.5.  
File: `app/api/actions/recalc/route.ts`

### Card 2: Industry Alignment Score (`iag_score`)
Based on `site_type_requirements` vs `site_services.purchased`.  
Any mandatory requirement with `purchased = false` → score forced to Red.  
Global requirements per site type — managed by superadmin only.  
Files: `app/lib/iag.ts`, `app/api/requirements/route.ts`, `app/api/requirements/generate/route.ts`

### Card 3: Documentation Health (`compliance_score`)
Drops when a document's `expiry_date` passes (not when it's about to expire).  
Expiring-within-30-days shows amber badge but doesn't reduce score.  
File: `app/api/documents/recalc-compliance.ts`

### Traffic light thresholds
Green ≥ 85% · Amber ≥ 50% · Red < 50%  
Helper: `scoreColor()` in `app/page.tsx`

---

## 7. Evidence Uploads

### Direct evidence upload (advisor → action detail panel)
Route: `POST /api/actions/[id]/evidence`  
Naming: `{DocumentName}-Ref {HazardRef}-EV{n} DD-MM-YY.ext`  
Storage: `evidence/{actionId}/{evidenceId}/{canonicalName}` in `client-uploads` bucket  
Also writes to Datto: W: drive `{source_folder_path}/Evidence/` or API fallback

### Client upload → link to action (advisor review panel)
Route: `PATCH /api/client-uploads/[id]` with `action: 'link'`  
Same naming convention and storage path as direct evidence.  
Steps: canonical name built → `action_evidence` row inserted → file copied to `evidence/` path → original `general-uploads/` file deleted → Datto file moved from "Client Provided Documents" to "Evidence" subfolder.

### General client uploads (pre-link)
Route: `POST /api/client-uploads`  
Storage: `general-uploads/{uploadId}/{originalFilename}` in `client-uploads` bucket  
Also uploaded to Datto "Client Provided Documents" folder

### Supabase storage layout
Single bucket: `client-uploads`. Two path prefixes within it:
- `general-uploads/{uploadId}/{filename}` — pre-link client uploads
- `evidence/{actionId}/{evidenceId}/{canonicalName}` — formally linked evidence

### `client_uploads` PATCH operations
Three actions supported via `PATCH /api/client-uploads/[id]`:
- **`link`** — links to an action: creates `action_evidence` row, copies file to `evidence/` path, deletes original, updates `status = 'linked'`, sets `action_id` and `action_evidence_id`
- **`acknowledge`** — advisor has reviewed but not linked: sets `status = 'acknowledged'`, `reviewed_by`, `reviewed_at`, `review_note`
- **`hide`** — soft-hide from default view: sets `hidden = true`. Fetch with `?includeHidden=true` to see hidden items. Never physically deleted by this action.

---

## 8. Document Sections in UI

`SiteDocumentsTab` in `app/page.tsx` has two collapsible accordion sections:

- **Amber — "Client Managed Documents"**: `site_documents` where `client_provided = true`. Accordion opens/closes with `activeSection === 'docs'`. Client user can delete. Upload creates a new `site_documents` row.
- **Indigo — "Uploaded Evidence"**: `client_uploads` (general evidence from client). Accordion opens/closes with `activeSection === 'evidence'`. Bulk delete in header.

Accordion is exclusive — opening one closes the other. `expandedDocId` tracks which doc card is open; opening a new one closes the previous. Clicking a doc card opens its actions directly (no separate actions toggle).

`DocumentCard` colour logic (by priority):
1. Expired → rose
2. Expiring soon (≤30 days) → amber
3. Has valid expiry → emerald
4. `client_provided = true` → amber
5. Default → slate/white

---

## 9. Key File Map

| File | Purpose |
|---|---|
| `app/page.tsx` | All UI (~8,000+ lines). Split when doing perf work. |
| `app/api/client-uploads/route.ts` | GET/POST for general client uploads |
| `app/api/client-uploads/[id]/route.ts` | GET (signed URL) / PATCH (link, acknowledge, hide) / DELETE |
| `app/api/actions/[id]/evidence/route.ts` | Direct evidence uploads from advisor panel |
| `app/api/actions/recalc/route.ts` | Recalculates `action_progress` score |
| `app/api/documents/recalc-compliance.ts` | Recalculates `compliance_score` |
| `app/api/datto/folder-utils.ts` | Datto auth constants + folder resolution helpers |
| `app/api/datto/file/readactions/route.ts` | Parses Word XML action table (no Gemini) |
| `app/api/sync-site/route.ts` | In-app AI sync — extracts actions via Gemini |
| `app/api/requirements/route.ts` | CRUD for site_type_requirements |
| `app/api/requirements/generate/route.ts` | AI generation of requirements via Claude |
| `app/lib/iag.ts` | IAG score calculation utility |
| `app/report/page.tsx` | PDF report generation |
| `supabase/schema.sql` | Auto-dumped at every session start — always current |
| `cloud_function/main.py` | GCP Cloud Function: Datto → Gemini Files API sync |

---

## 10. Known Bugs and Deferred Work

### Deferred features
- **app/page.tsx split**: 8,000+ lines — split into tab components when working on performance
- **AiSuggestionsPanel edit flow**: Should match the normal advisor action review panel (not yet aligned)
- **RA types (CoSHH, DSE, non-standard)**: Different document formats not yet handled gracefully
- **AI cost log**: Superadmin per-org/per-site usage breakdown not yet built
- **Email notifications**: Staying on Supabase built-in for now; revisit Resend/M365 SMTP before production
- **Word .doc → .docx auto-conversion**: Paul has a Word macro; not yet wired up
- **Background AI sync**: Cloud Function with "pending review" status agreed in design but not built
- **Superadmin mirror of advisor dashboard**: Not yet built
- **Delete/edit actions UI**: Individual delete, edit modal, superadmin clear-all discussed but not built

### Known issues
- **`formatExtractedText` bullet layout**: Bullet points in hazard/existing-controls fields render as separate `<p>` tags instead of a 2-column `<ul>` in some cases. Root cause: paragraphs split before regex normalisation runs. Workaround: split by `\n+`, detect multiple `•` lines, force into single list.
- **CloudConvert API key**: Needs to be recreated with `user.read + job.read` scopes to fix usage tab
- **Word "Do you trust this content?" prompt**: Needs IT/Intune `hsopen://` handler for one-click opening; currently requires user to click through prompt

---

## 11. Credentials and Security Notes

- Datto API credentials were exposed in chat on 2026-03-20 and need rotating in the Datto AI Studio admin portal
- `.env.yaml`, `deploy.sh`, and `datto-test.js` contain live credentials — all in `.gitignore`
- Never commit `.env`, `.env.yaml`, or `deploy.sh`
- Supabase service role key is server-side only (`SUPABASE_SERVICE_ROLE_KEY`) — never expose to client

---

## 12. Future Vision — Full Risk Assessment Platform

Paul described this as the "holy grail" long-term goal. Not current work, but **flag to Paul if any change would make this harder to add later** (rigid action schema, hardcoded document types, auth patterns that don't support mobile).

### Core requirements
- Admin creates assessment templates (structured form builder or Word template upload)
- Advisors fill in assessments on-site from those templates
- Assessments stored in Supabase, tied to client/site
- Professional PDF output added to client portal and uploaded to Datto
- Assessments editable post-submission (update actions, mark completed)
- Full offline support — advisors have no signal at many client sites
- Works on PC, mobile browser; eventually dedicated mobile app with photo capture

### Agreed phase plan
1. **Phase 1** — Online-only: data model, template builder, assessment fill/edit, PDF, Datto upload
2. **Phase 2** — PWA: offline caching + background sync for assessment forms
3. **Phase 3** — Background sync + conflict resolution
4. **Phase 4** (optional) — React Native/Expo if PWA camera/UX proves insufficient on iOS

### Migration note
PWA → native app is not starting from scratch. Supabase client, sync logic, API/Datto integration, and PDF generation are all reusable. Only the UI layer needs rewriting (~20–30% of total effort).

---

## 14. Development Notes

- **Schema dump**: `supabase/schema.sql` is auto-dumped at session start via a hook — always reflects current prod schema
- **Datto API root folder**: `1239993420` ("Entrust Global" folder). `datto-test.js` in project root for manual API testing
- **Scoring recalc**: Must be triggered explicitly after action or document changes — not automatic
- **`excluded_datto_folder_ids`**: Site-level array of Datto folder IDs to skip during sync (e.g. Archive folders)
- **`included_datto_folder_ids`**: If non-empty, sync only these folder IDs (allowlist overrides excludes)
- **Action `issue_date`**: Stored as text, not date — some documents have relative or non-standard dates
