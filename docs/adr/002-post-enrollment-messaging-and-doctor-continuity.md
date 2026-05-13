# ADR 002: Post-enrollment messaging — doctor continuity vs clinic visibility

## Status

Accepted for messaging identity rules. **`patient_chat_threads.assigned_doctor_id`** is the source of truth for patient-facing messaging / operational responder; **`patients.primary_doctor_id`** is medical/roster metadata and must not silently overwrite thread assignment (implemented in `fetchLeadThreadAssignmentForPatient`; sync only via explicit flows such as admin assign-doctor).

## Context

Patients often anchor trust on a **specific clinician** (consultation, photos, treatment planning, pricing). After **lead → enrollment**, the product must not feel like the conversation “switched” from **Dr X** to **the clinic** unless that change is **explicit**.

Observed failure mode: continuity breaks when **patient-facing identity** (who they think they are talking to) diverges from **thread assignment**, **primary_doctor_id**, **message sender normalization**, or **access rules** after `is_lead` clears.

## Decision — target operational model

### Principle: visibility expands, ownership stays

- **Enrollment** adds **clinic membership / staff visibility**; it MUST **not** by default replace the **primary responder**.
- **Clinic visibility ≠ patient-facing identity.** Staff may see the thread; the UI should still foreground **who owns the relationship** unless policy says otherwise.

### Default lifecycle

1. **Lead stage** — `patient_chat_threads.assigned_doctor_id` = Dr X (after routing / manual assign). Same thread continues through enrollment when identity is stable (same `patients.id`, same patient+clinic thread row).
2. **Patient enrolls** — Same thread; **`assigned_doctor_id` remains Dr X** unless a documented workflow changes it.
3. **Clinic admin / supervisors** — **Read + intervene** where product/policy allows; not automatically the **named** counterparty in the patient header.
4. **Other clinic doctors** — **Shared visibility** subject to policy (treatment team, coverage, etc.).
5. **Reassignment** — Only via **explicit** actions: inactive doctor, removal, coordinator model, after-hours routing, **manual reassign**. Product SHOULD surface a clear line (e.g. system or banner message: care transferred to Dr Y / coordinator changed). **No silent swap** of the person the patient believes they are messaging.

### Roles (conceptual)

| Role | Responsibility |
|------|----------------|
| **Assigned doctor** (`patient_chat_threads.assigned_doctor_id`) | Default **primary responder** for that thread |
| **Patient.primary_doctor_id** (if used) | **Administrative / roster** primary; must stay consistent with continuity rules below |
| **Clinic admin** | **Supervisor / override** — visibility and exceptional sends, not default replacement for Dr X |
| **Other doctors** | Policy-based shared visibility (e.g. treatment team before strict enrolled-only rules) |

### Patient-facing API shape

`leadAssignment` on GET patient/doctor messages includes:

- **`assignedDoctorId` / `doctorName` / `assignedDoctor`** — from **`patient_chat_threads.assigned_doctor_id`** only (messaging / operational responder).
- **`medicalPrimaryDoctorId` / `medicalPrimaryDoctor`** — from **`patients.primary_doctor_id`** when set (care-team / records context).
- **`doctorAssignmentMismatch`** — `true` when both UUIDs are set and differ (clients may show an explanatory line; admin dashboards should warn).

There is **no** automatic thread update from `primary_doctor_id` on this read path. **`syncPatientLeadThreadAssignedDoctor`** remains for **explicit** actions (e.g. `PUT /api/admin/patients/assign-doctor`).

Messages SHOULD preserve **per-sender display** (doctor vs admin vs system), not only `PATIENT` vs `CLINIC` (still incremental).

## Implementation notes (`cliniflow-backend-clean` + app)

- Enrollment (`PATCH /api/patient/clinic`) still does **not** rewrite thread assignment.
- **`resolveDoctorPatientMessagingAccess`** — enrolled patients: send restrictions remain tied to thread assignee; generic **CLINIC** bubbles may still obscure who replied until message payloads carry sender identity.
- Patient chat header uses **`leadAssignment`** when the viewer is a patient (name + optional mismatch subtitle).

## Engineering guidelines

1. **Default:** On enrollment, **do not** clear or overwrite **`patient_chat_threads.assigned_doctor_id`** unless explicit reassignment or approved automation (inactive doctor, etc.).
2. **`primary_doctor_id`** MUST NOT override messaging display or trigger silent thread sync; align thread only via explicit transfer / admin assign / routing jobs.
3. **Reassignment:** Persist audit fields (`assigned_at`, optional `assigned_by`, previous doctor id) and emit **visible** transfer signals (message row or structured event).
4. **API/UI:** Surface **messaging responder** vs **medical primary** vs **clinic participants** where relevant.

## Relationship to ADR 001

- Canonical patient id remains **`patients.id`**; threads and assignments reference that id.
- Membership expansion (clinic visibility) is orthogonal to **who the patient experiences as their doctor**.

## Consequences

- **Positive:** Clear product story (trust with a person); fewer “did my doctor disappear?” reports; **read paths no longer mutate** operational ownership (no “read causes write” drift from resolver code).
- **Remaining:** Sender enrichment in message payloads, explicit transfer audit trail, admin tooling, and optional API split between chart vs chat assignment.

## Roadmap — explicit continuity & operational clarity

Direction: evolve from generic CRM/chat toward **care continuity**, **operational ownership clarity**, and **relationship-preserving** longitudinal communication (especially dental workflows).

| Priority | Item | Intent |
|----------|------|--------|
| 1 | **Explicit operational transfer metadata** | Persist `transfer_reason`, `transferred_by`, `transferred_at` (and ideally prior assignee) on reassignment — table columns on `patient_chat_threads` and/or `patient_chat_thread_transfers` audit table. |
| 2 | **Patient-visible transfer events** | System/timeline messages (e.g. “Dr. Burhan transferred your care to Dr. Ayşe”) so reassignment is never invisible. |
| 3 | **Admin mismatch dashboard / alerts** | Operational view where **messaging responder ≠ medical owner** (`doctorAssignmentMismatch` or server-side equivalent list/filter). |
| 4 | **Long-term API separation** | Today `PUT /api/admin/patients/assign-doctor` intentionally couples **chart owner** (`primary_doctor_id`) and **messaging owner** (thread sync). Eventually: **`assign-medical-owner`**, **`assign-chat-responder`**, **`transfer-chat-thread`** (or flags on one endpoint) so admins can change records without implying chat transfer and vice versa. |
| 5 | **UI: responder identity over generic “clinic”** | Continue replacing undifferentiated clinic/chat labels with **actual responder identity** when payloads allow (thread list, bubbles, push copy). |

## References (code)

- `PATCH /api/patient/clinic` — enrollment flag `is_lead: false` without thread patch.
- `fetchLeadThreadAssignmentForPatient`, `syncPatientLeadThreadAssignedDoctor`.
- `resolveDoctorPatientMessagingAccess`, `patientRowRequiresAssignedDoctorMessagingOnly`.
- Patient app: `app/(app)/(tabs)/chat.tsx` — `leadAssignment`-driven header + mismatch subtitle.
