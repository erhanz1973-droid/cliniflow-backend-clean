/**
 * Single source of truth for staged rollout verification.
 * Coordinator / Treatment Guide stack (May 2026).
 */

/** Apply in Supabase SQL editor or CLI — filename order. */
const REQUIRED_MIGRATIONS = [
  "20260516120000_messages_sender_type_allow_clinic.sql",
  "20260517100000_ai_coordinator_lead_pipeline.sql",
  "20260517120000_ai_coordinator_coordination.sql",
  "20260517140000_ai_coordinator_workspace.sql",
  "20260517160000_clinic_partner_hotels.sql",
  "20260517180000_clinic_treatment_protocols.sql",
  "20260517200000_ai_visit_plan_drafts.sql",
  "20260517220000_ai_patient_documents.sql",
  "20260517240000_ai_patient_documents_consent_attribution.sql",
  "20260517260000_intake_journey_event_type.sql",
  "20260517300000_upload_content_hash_dedupe.sql",
  "20260518120000_patient_clinic_membership_archive.sql",
  "20260518130000_clinic_ai_settings.sql",
  "20260518150000_clinic_operations_profile_v2.sql",
  "20260518160000_clinic_treatment_protocols_ensure.sql",
  "20260518170000_clinic_operations_profile_v2_repair.sql",
  "20260518180000_clinic_treatment_variants.sql",
  "20260518190000_treatment_price_variants.sql",
  "20260518200000_treatment_price_label_i18n.sql",
  "20260518210000_treatment_price_variants_clinic_id.sql",
];

/** Probe tables/columns via Supabase REST (limit 0). */
const SCHEMA_PROBES = [
  {
    id: "lead_pipeline",
    table: "ai_coordinator_lead_profiles",
    columns: [
      "id",
      "session_id",
      "clinic_id",
      "operational_intake_flags",
      "lead_score",
      "is_hot",
    ],
  },
  {
    id: "coordination",
    table: "ai_coordinator_lead_profiles",
    columns: [
      "coordination_mode",
      "last_patient_message_at",
      "last_human_reply_at",
      "escalation_flags",
      "ai_unresolved",
    ],
  },
  {
    id: "lead_events",
    table: "ai_coordinator_lead_events",
    columns: ["profile_id", "event_type", "event_metadata", "patient_message", "ai_reply"],
  },
  {
    id: "patient_documents",
    table: "ai_patient_documents",
    columns: [
      "lead_profile_id",
      "document_type",
      "review_status",
      "requires_doctor_review",
      "patient_confirmed_upload_consent",
    ],
  },
  {
    id: "operational_tasks",
    table: "ai_coordinator_operational_tasks",
    columns: ["profile_id", "task_type", "status"],
  },
  {
    id: "visit_plans",
    table: "ai_visit_plan_drafts",
    columns: ["lead_profile_id", "status", "plan_json"],
  },
  {
    id: "clinic_ai_settings",
    table: "clinic_ai_settings",
    columns: [
      "clinic_id",
      "autonomy_config",
      "escalation_config",
      "tone_config",
      "materials_config",
      "logistics_config",
      "payment_policy_config",
      "internal_notes_config",
      "safety_rules",
      "communication_policy",
    ],
  },
  {
    id: "clinic_treatment_catalog",
    table: "clinic_treatment_catalog",
    columns: ["clinic_id", "name", "price_min", "price_max", "currency", "ai_notes"],
  },
  {
    id: "treatment_price_variants",
    table: "treatment_price_variants",
    columns: [
      "treatment_price_id",
      "brand_name",
      "origin_country",
      "material_type",
      "tier",
      "price_min",
      "currency",
      "is_default",
    ],
  },
  {
    id: "clinic_treatment_protocols",
    table: "clinic_treatment_protocols",
    columns: ["clinic_id", "treatment_type", "typical_visit_count", "is_active", "sort_order"],
  },
];

/** HTTP routes that must exist (status may be 401 without auth — not 404). */
const HTTP_ROUTE_PROBES = [
  { method: "GET", path: "/api/health", expectStatuses: [200] },
  { method: "GET", path: "/api/health?deep=1", expectStatuses: [200] },
  { method: "POST", path: "/ai/intake-tags", expectStatuses: [400, 401, 403, 422], body: {} },
  { method: "GET", path: "/api/patient/me/intake-journey", expectStatuses: [401, 403] },
  { method: "GET", path: "/api/admin/ai-leads/queues", expectStatuses: [401, 403] },
  { method: "GET", path: "/api/admin/clinic/ai-ops/meta", expectStatuses: [401, 403] },
  { method: "GET", path: "/api/admin/clinic/ai-ops/settings", expectStatuses: [401, 403] },
  { method: "GET", path: "/api/admin/clinic/ops-profile/meta", expectStatuses: [401, 403] },
  { method: "GET", path: "/api/admin/clinic/ops-profile", expectStatuses: [401, 403] },
];

/** Paths that must NOT exist in production API surface. */
const FORBIDDEN_HTTP_PATHS = [
  "/api/admin/simulation",
  "/api/simulation",
  "/api/dev/seed-coordinator",
];

/** Files that must not register simulation HTTP routes in the live server. */
const SERVER_ENTRY_FILES = ["index.cjs"];

module.exports = {
  REQUIRED_MIGRATIONS,
  SCHEMA_PROBES,
  HTTP_ROUTE_PROBES,
  FORBIDDEN_HTTP_PATHS,
  SERVER_ENTRY_FILES,
};
