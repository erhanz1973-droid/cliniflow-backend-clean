# ADR 001: Patient identity, clinic membership, and continuity

## Status

Accepted (directional) — companion implementation lands incrementally in `index.cjs` and migrations.

## Context

Clinifly historically uses two patient identifiers:

- **`patients.id`** — UUID, primary key; correct anchor for FKs (`messages.patient_id`, `patient_files.patient_id`, chat threads).
- **`patients.patient_id`** — legacy public / mobile string (`p_…`, `LD_…`, etc.).

Additional pressures:

- Disk paths under `public/uploads/*/<folder>/` keyed by whatever the client sent at upload time.
- Optional **multi-row-per-human** patterns (e.g. clinic-scoped registration) combined with **clinic-unaware** OTP lookup produced non-deterministic `.limit(1)` selection.
- Railway (and similar) **ephemeral filesystem**: binaries under `public/uploads` are not a durable source of truth.

Together these break **lead → enrollment**, **doctor continuity**, **message/media timelines**, and **admin visibility** unless bridged by resolvers.

## Decision

### 1. Canonical human identity

- **Canonical technical ID:** `patients.id` (UUID).
- **JWT `patientId` (new tokens):** SHOULD be that UUID; legacy strings remain accepted server-side via `resolveMessagesPatientDbId` until clients migrate.
- **`patients.patient_id`:** treated as **legacy alias / display**, not a second source of truth for new features.

### 2. Clinic membership vs identity

- **Long-term:** clinic attachment SHOULD be modeled as **membership** (e.g. `patient_clinic_memberships` or equivalent), not “new human = new `patients` row” by default.
- **Until then:** registration comments that imply “separate row per tenant” MUST be reconciled with product expectations; where duplicates exist, **merge rules** or **deterministic resolution** MUST apply (see §4).

### 3. OTP / login resolution (deterministic)

- Lookup by email or phone MAY return **multiple rows**.
- Selection rules (in order):

  1. If request includes **`clinicId`** (UUID) or **`clinicCode`** (resolved to clinic UUID): prefer rows where `patients.clinic_id` equals that UUID.
  2. If no row matches the hint but rows exist: fall back to global pool and **log a warning** (backward compatibility); clients SHOULD send clinic context for multi-tenant users.
  3. Sort pool by **`updated_at` descending** (when column exists), then **`id` ascending** for stable ties.

- **Ambiguity:** If multiple rows remain clinically ambiguous, product SHOULD evolve toward **explicit clinic picker** or **membership table** instead of silent guesses.

### 4. Enrollment / merge

- **Preferred:** update existing `patients` row (set `clinic_id`, status, etc.) — **do not** create a second row for the same person in the same enrollment journey.
- **If duplicates already exist:** runbook = **merge job**: re-point `messages`, `patient_files`, `patient_chat_threads`, etc. to canonical `patients.id`, then deprecate duplicate rows (with audit).

### 5. Storage

- **Short term:** compatibility bridges (`resolvePatientFolderIdVariants`, disk scans, clinic-scoped admin reads).
- **Long term:** **Supabase Storage** (or equivalent) + DB metadata (`patient_media` / `patient_assets`) + signed URLs; disk is **not** authoritative.

### 6. Thread and doctor continuity

- **`patient_chat_threads`** and `assigned_doctor_id` are keyed by canonical `patients.id`.
- Enrollment MUST NOT silently **change** primary responder unless explicitly intended; clinic membership **extends visibility**, not replaces assignment semantics.
- Patient-facing **messaging** identity and `leadAssignment` fields tied to it use **`patient_chat_threads.assigned_doctor_id`**; **`patients.primary_doctor_id`** is medical/roster context and MUST NOT silently overwrite thread assignment (see ADR 002).

See **ADR 002** (`002-post-enrollment-messaging-and-doctor-continuity.md`) for the post-enrollment messaging model, `primary_doctor_id` vs thread assignment, and patient-facing identity vs clinic visibility.

### 7. Migrations

1. Backfill Storage from disk where feasible; record canonical `patient_id` + `storage_key` in DB.
2. Optionally add `updated_at` / indexes supporting OTP ordering if missing.
3. Introduce membership table when ready; migrate `patients.clinic_id` semantics.

## Consequences

- **Positive:** One resolver strategy for OTP; JWT aligned with UUID; clearer path to Storage and membership.
- **Negative:** Clients SHOULD pass `clinicCode` / `clinicId` on OTP request/verify where the user chose a clinic; strict multi-clinic UX may require UI changes.

## References (code)

- `resolveMessagesPatientDbId`, `patientIdsMatchForToken`, `app.param("patientId")`
- `resolvePatientForOtp` + clinic hint + deterministic pick
- `resolvePatientFolderIdVariants`, `collectPatientFiles`
- `runPatientRegister` (duplicate / clinic-scoped registration behavior)
