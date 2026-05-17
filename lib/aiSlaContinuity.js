/**
 * SLA / immediate continuity messages when the clinic has not replied yet.
 * Reassurance only — not diagnosis or pricing offers.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");
const { getClinicAiProfile } = require("./clinicAiSettings");
const { resolveInquiryDelegation, buildClinicPolicySummary } = require("./aiDelegation");
const { insertTimelineEvent } = require("./aiCoordinatorTimeline");
const { COORDINATION_AI } = require("./aiCoordinatorCoordination");
const { runAiReplyForClinicInbound } = require("./aiPatientInboundReply");
const {
  resolveOperationalClinicId,
  logAiOrchestrationSkip,
  logAiDelegationEvaluation,
} = require("./clinicOperationalContext");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {null | ((opts: Record<string, unknown>) => Promise<{ data?: unknown, error?: unknown }>)} */
let insertClinicMessageFn = null;

const CONTINUITY_TEMPLATES = {
  en: `Thank you for your request 😊\nOur clinic team is currently reviewing your information and any files you shared. We will get back to you shortly with treatment details and estimated pricing.`,
  tr: `Talebiniz için teşekkür ederiz 😊\nKlinik ekibimiz bilgilerinizi ve paylaştığınız dosyaları inceliyor. Kısa süre içinde tedavi detayları ve tahmini fiyatlandırma ile size dönüş yapacağız.`,
  ru: `Спасибо за ваш запрос 😊\nКоманда клиники сейчас изучает вашу информацию и загруженные файлы. Мы скоро свяжемся с вами с деталями лечения и ориентировочной стоимостью.`,
  ka: `გმადლობთ მოთხოვნისთვის 😊\nჩვენი კლინიკის გუნდი ამჟამად გადაიხედებს თქვენს ინფორმაციასა და ფაილებს. მალე დაგიბრუნდებით მკურნალობის დეტალებითა და სავარაუდო ფასებით.`,
};

/**
 * @param {{ insertClinicMessage: typeof insertClinicMessageFn }} deps
 */
function setupAiSlaContinuity(deps) {
  insertClinicMessageFn = deps.insertClinicMessage || null;
  if (process.env.AI_SLA_CONTINUITY_ENABLED === "false") return;
  const sweepMs = Math.max(
    60_000,
    parseInt(process.env.AI_SLA_CONTINUITY_SWEEP_MS || String(2 * 60 * 1000), 10) || 120_000,
  );
  setInterval(() => {
    runSlaContinuitySweep().catch((e) => {
      console.warn("[aiSlaContinuity] sweep:", e?.message || e);
    });
  }, sweepMs).unref?.();
  console.log("[aiSlaContinuity] SLA continuity sweep every", sweepMs, "ms");
}

/**
 * @param {string} clinicId
 */
function pickContinuityLanguage(clinicId) {
  return getClinicAiProfile(clinicId).then((profile) => {
    const code =
      String(profile.tone?.primaryLanguage || profile.tone?.enabledLanguageCodes?.[0] || "en")
        .trim()
        .toLowerCase()
        .slice(0, 2) || "en";
    return CONTINUITY_TEMPLATES[code] ? code : "en";
  });
}

/**
 * Dedupe: only one continuity per patient-waiting window.
 * @param {string} profileId
 * @param {string|null} lastPatientAt
 */
async function shouldSkipContinuity(profileId, lastPatientAt) {
  if (!lastPatientAt) return true;
  const { data, error } = await supabase
    .from("ai_coordinator_lead_events")
    .select("id, event_type, event_metadata, created_at")
    .eq("profile_id", profileId)
    .gte("created_at", lastPatientAt)
    .in("event_type", ["continuity_fallback", "system"])
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) {
    console.warn("[aiSlaContinuity] dedupe:", error.message);
    return false;
  }
  for (const row of data || []) {
    if (row.event_type === "continuity_fallback") return true;
    const meta = row.event_metadata && typeof row.event_metadata === "object" ? row.event_metadata : {};
    if (meta.kind === "continuity_fallback") return true;
  }
  return false;
}

/**
 * @param {Record<string, unknown>} row
 */
function isWaitingOnClinic(row) {
  const lp = row.last_patient_message_at || row.last_channel_message_at;
  const lh = row.last_human_reply_at;
  if (!lp) return false;
  if (!lh) return true;
  return new Date(lp).getTime() > new Date(lh).getTime();
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 * @param {string} [patientMessage]
 */
async function touchLeadProfileFromInbound(patientId, clinicId, patientMessage) {
  if (!isSupabaseEnabled() || !UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
    return null;
  }
  const nowIso = new Date().toISOString();
  const sessionId = `inq_${patientId}_${clinicId}`;
  const msg = String(patientMessage || "").trim().slice(0, 4000) || null;

  const { data: existing } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id, session_id")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("ai_coordinator_lead_profiles")
      .update({
        last_patient_message: msg,
        last_patient_message_at: nowIso,
        last_channel_message_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data: inserted, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .insert({
      session_id: sessionId,
      patient_id: patientId,
      clinic_id: clinicId,
      coordination_mode: COORDINATION_AI,
      last_patient_message: msg,
      last_patient_message_at: nowIso,
      last_channel_message_at: nowIso,
      source: "patient_inquiry",
      primary_channel: "in_app",
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: again } = await supabase
        .from("ai_coordinator_lead_profiles")
        .select("id")
        .eq("patient_id", patientId)
        .eq("clinic_id", clinicId)
        .maybeSingle();
      return again?.id || null;
    }
    console.warn("[aiSlaContinuity] touch profile:", error.message);
    return null;
  }
  return inserted?.id || null;
}

/**
 * @param {Record<string, unknown>} profileRow
 * @param {{ immediate?: boolean }} [opts]
 */
async function trySendContinuityForProfile(profileRow, opts = {}) {
  if (!insertClinicMessageFn) return { sent: false, reason: "not_configured" };

  const profileId = String(profileRow.id || "");
  const patientId = String(profileRow.patient_id || "");
  const clinicId = String(profileRow.clinic_id || "");
  if (!UUID_RE.test(profileId) || !UUID_RE.test(patientId) || !UUID_RE.test(clinicId)) {
    return { sent: false, reason: "invalid_ids" };
  }

  if (!isWaitingOnClinic(profileRow)) {
    return { sent: false, reason: "not_waiting" };
  }

  const lastPatientAt = String(
    profileRow.last_patient_message_at || profileRow.last_channel_message_at || "",
  );
  if (await shouldSkipContinuity(profileId, lastPatientAt)) {
    return { sent: false, reason: "already_sent" };
  }

  const { data: recentAi } = await supabase
    .from("ai_coordinator_lead_events")
    .select("id")
    .eq("profile_id", profileId)
    .eq("event_type", "ai_reply")
    .gte("created_at", lastPatientAt)
    .limit(1);
  if (recentAi?.length) {
    return { sent: false, reason: "ai_already_replied" };
  }

  const clinicProfile = await getClinicAiProfile(clinicId);
  const clinicPolicy = buildClinicPolicySummary(clinicProfile);
  const delegation = resolveInquiryDelegation(profileRow, { clinicPolicy });
  logAiDelegationEvaluation(delegation, clinicId);

  if (delegation.aiEscalationRequired) {
    console.log("[aiSlaContinuity] continuity skipped: escalation_required", {
      profileId: profileId.slice(0, 8),
    });
    return { sent: false, reason: "escalation" };
  }
  const continuityAllowed =
    !delegation.aiPaused &&
    (delegation.autoReplyAllowed || delegation.draftGenerationAllowed);
  if (!continuityAllowed) {
    console.log("[aiSlaContinuity] continuity skipped: ai_disabled", {
      profileId: profileId.slice(0, 8),
      aiPaused: delegation.aiPaused,
      autoReplyAllowed: delegation.autoReplyAllowed,
      draftGenerationAllowed: delegation.draftGenerationAllowed,
    });
    return { sent: false, reason: "ai_disabled" };
  }

  const fallbackMin = Number(clinicProfile.escalation?.aiFallbackAfterMinutes) || 30;
  const immediateEnabled = process.env.AI_CONTINUITY_IMMEDIATE !== "false";
  const immediateMin = Math.max(
    0,
    parseFloat(process.env.AI_CONTINUITY_IMMEDIATE_MINUTES || "0") || 0,
  );
  const thresholdMin = opts.immediate && immediateEnabled ? immediateMin : fallbackMin;

  const waitingMs =
    Date.now() - new Date(lastPatientAt).getTime();
  if (!Number.isFinite(waitingMs) || waitingMs < thresholdMin * 60 * 1000) {
    return { sent: false, reason: "below_threshold", waitingMs, thresholdMin };
  }

  const lang = await pickContinuityLanguage(clinicId);
  const text = CONTINUITY_TEMPLATES[lang] || CONTINUITY_TEMPLATES.en;
  const nowIso = new Date().toISOString();

  const insertResult = await insertClinicMessageFn({
    patientId,
    message: text,
    type: "continuity_ack",
    contextClinicId: clinicId,
    senderName: "Care Team",
  });

  if (insertResult?.error) {
    console.warn("[aiSlaContinuity] insert message:", insertResult.error?.message || insertResult.error);
    return { sent: false, reason: "insert_failed" };
  }

  await supabase
    .from("ai_coordinator_lead_profiles")
    .update({
      last_ai_reply_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", profileId);

  await insertTimelineEvent({
    profileId,
    eventType: "continuity_fallback",
    eventMetadata: {
      kind: "continuity_fallback",
      mode: opts.immediate ? "immediate" : "sla",
      thresholdMinutes: thresholdMin,
      language: lang,
    },
    aiReply: text,
    channel: "in_app",
  });

  await supabase.from("ai_coordinator_channel_messages").insert({
    profile_id: profileId,
    channel: "in_app",
    direction: "outbound",
    message_role: "assistant",
    body: text,
  });

  console.log("[aiSlaContinuity] sent continuity", {
    profileId: profileId.slice(0, 8),
    patientId: patientId.slice(0, 8),
    clinicId: clinicId.slice(0, 8),
    mode: opts.immediate ? "immediate" : "sla",
  });

  return { sent: true, profileId };
}

/**
 * After patient sends a clinic-thread message or treatment quote request.
 * @param {{
 *   patientId: string,
 *   clinicId: string,
 *   patientMessage?: string,
 *   source?: 'chat'|'quote_request',
 *   contextMode?: 'coordinator'|'treatment_guide',
 * }} params
 */
async function afterPatientInboundMessage(params) {
  if (process.env.AI_SLA_CONTINUITY_ENABLED === "false") {
    console.log("[aiSlaContinuity] inbound skipped: AI_SLA_CONTINUITY_ENABLED=false");
    return;
  }
  if (!isSupabaseEnabled()) return;

  const patientId = String(params.patientId || "").trim();
  let clinicId = String(params.clinicId || "").trim();
  const patientMessage = String(params.patientMessage || "").trim();
  if (!UUID_RE.test(patientId)) return;
  if (!patientMessage) return;

  if (!UUID_RE.test(clinicId)) {
    const resolved = await resolveOperationalClinicId(patientId, {
      contextClinicId: params.clinicId,
      offerId: params.offerId,
      treatmentRequestId: params.treatmentRequestId,
      logLabel: "inbound_ai_hook",
    });
    clinicId = String(resolved.clinicId || "").trim();
    if (!UUID_RE.test(clinicId)) {
      logAiOrchestrationSkip(null, patientId, {
        ...resolved,
        reason: "clinic_unresolved",
        source: params.source,
      });
      return;
    }
  }

  await touchLeadProfileFromInbound(patientId, clinicId, patientMessage);

  const delayMs = Math.max(
    500,
    parseInt(process.env.AI_INBOUND_REPLY_DELAY_MS || "2500", 10) || 2500,
  );

  const source = params.source || "chat";
  const contextMode = params.contextMode || "coordinator";

  setTimeout(async () => {
    try {
      const aiResult = await runAiReplyForClinicInbound({
        patientId,
        clinicId,
        patientMessage,
        channel: "in_app",
        contextMode,
        source,
      });

      if (aiResult.sent) return;

      if (
        aiResult.reason === "ai_disabled" ||
        aiResult.reason === "escalation" ||
        aiResult.reason === "already_replied" ||
        aiResult.reason === "already_replied_event"
      ) {
        console.log("[aiSlaContinuity] continuity not attempted after AI:", {
          patientId: patientId.slice(0, 8),
          clinicId: clinicId.slice(0, 8),
          aiReason: aiResult.reason,
        });
        return;
      }

      const continuity = await runContinuityForPatientClinic(patientId, clinicId, {
        immediate: true,
      });
      if (!continuity.sent) {
        console.log("[aiSlaContinuity] continuity fallback result:", {
          patientId: patientId.slice(0, 8),
          clinicId: clinicId.slice(0, 8),
          reason: continuity.reason,
        });
      }
    } catch (e) {
      console.warn("[aiSlaContinuity] inbound:", e?.message || e);
    }
  }, delayMs).unref?.();
}

/**
 * @param {string} patientId
 * @param {string} clinicId
 * @param {{ immediate?: boolean }} [opts]
 */
async function runContinuityForPatientClinic(patientId, clinicId, opts = {}) {
  const { data, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(
      "id, patient_id, clinic_id, coordination_mode, ai_mode, ai_paused, ai_escalation_required, escalation_flags, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
    )
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error || !data) return { sent: false, reason: "no_profile" };
  return trySendContinuityForProfile(data, opts);
}

/**
 * Periodic sweep for all clinics — SLA threshold from clinic AI settings.
 */
async function runSlaContinuitySweep() {
  if (process.env.AI_SLA_CONTINUITY_ENABLED === "false") return { scanned: 0 };
  if (!isSupabaseEnabled() || !insertClinicMessageFn) return { scanned: 0 };

  const maxAgeHours = Math.max(1, parseInt(process.env.AI_SLA_CONTINUITY_MAX_AGE_HOURS || "72", 10) || 72);
  const sinceIso = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select(
      "id, patient_id, clinic_id, coordination_mode, ai_mode, ai_paused, ai_escalation_required, escalation_flags, last_patient_message_at, last_channel_message_at, last_human_reply_at, last_ai_reply_at",
    )
    .not("patient_id", "is", null)
    .not("clinic_id", "is", null)
    .gte("last_patient_message_at", sinceIso)
    .order("last_patient_message_at", { ascending: true })
    .limit(80);

  if (error) {
    console.warn("[aiSlaContinuity] sweep query:", error.message);
    return { scanned: 0, error: error.message };
  }

  let sent = 0;
  for (const row of rows || []) {
    if (!isWaitingOnClinic(row)) continue;
    const result = await trySendContinuityForProfile(row, { immediate: false });
    if (result.sent) sent += 1;
  }

  if (sent > 0) {
    console.log("[aiSlaContinuity] sweep sent", sent, "continuity message(s)");
  }
  return { scanned: (rows || []).length, sent };
}

module.exports = {
  setupAiSlaContinuity,
  afterPatientInboundMessage,
  runContinuityForPatientClinic,
  runSlaContinuitySweep,
  touchLeadProfileFromInbound,
};
