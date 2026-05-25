/**
 * Channel identity resolution — Messenger PSID → patient + lead profile.
 */

const crypto = require("crypto");
const { supabase, isSupabaseEnabled } = require("../supabase");
const { ensureLeadWorkspaceForClinic } = require("../patientLeadLifecycle");
const { patchProfilePrimaryChannel } = require("../coordinatorChannelPersistence");
const { fetchMessengerUserProfile } = require("./metaGraph");
const { pageAccessTokenFromRow } = require("./metaPageConnections");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingColumnError(error) {
  const c = String(error?.code || "");
  const m = String(error?.message || "").toLowerCase();
  return (
    ["42703", "PGRST204", "PGRST205"].includes(c) ||
    (m.includes("column") && m.includes("does not exist"))
  );
}

function getMissingColumnName(error) {
  const m = String(error?.message || "");
  const quoted = m.match(/column ['"]?([^'"]+)['"]?/i);
  if (quoted?.[1]) return quoted[1].replace(/^patients\./, "");
  const cache = m.match(/Could not find the ['"]([^'"]+)['"] column/i);
  return cache?.[1] || null;
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} [selectClause]
 */
async function insertPatientWithPruning(payload, selectClause = "id, patient_id") {
  let current = { ...payload };
  let lastError = null;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const { data, error } = await supabase.from("patients").insert(current).select(selectClause).single();
    if (!error) return { data, error: null };
    lastError = error;
    if (!isMissingColumnError(error)) return { data: null, error };
    const col = getMissingColumnName(error);
    if (!col || !(col in current)) return { data: null, error };
    delete current[col];
  }
  return { data: null, error: lastError };
}

/**
 * @param {string} clinicId
 */
async function getClinicCodeForClinic(clinicId) {
  const { data } = await supabase.from("clinics").select("clinic_code").eq("id", clinicId).maybeSingle();
  return data?.clinic_code ? String(data.clinic_code).trim().toUpperCase() : null;
}

/**
 * @param {{
 *   clinicId: string,
 *   psid: string,
 *   pageId: string,
 *   pageConnectionRow?: Record<string, unknown>|null,
 *   displayName?: string,
 * }} params
 */
async function resolveMessengerIdentity(params) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_disabled" };

  const clinicId = String(params.clinicId || "").trim();
  const psid = String(params.psid || "").trim();
  const pageId = String(params.pageId || "").trim();
  if (!UUID_RE.test(clinicId) || !psid || !pageId) {
    return { ok: false, error: "invalid_params" };
  }

  const { data: existingIdentity } = await supabase
    .from("channel_identities")
    .select("id, patient_id, profile_id, display_name")
    .eq("clinic_id", clinicId)
    .eq("channel", "messenger")
    .eq("external_user_id", psid)
    .maybeSingle();

  if (existingIdentity?.patient_id) {
    const patientId = String(existingIdentity.patient_id);
    const workspace = await ensureLeadWorkspaceForClinic(patientId, clinicId, {
      source: "messenger",
      leadStatus: "inquiry",
    });
    let profileId = existingIdentity.profile_id ? String(existingIdentity.profile_id) : null;
    if (!profileId) {
      const { data: prof } = await supabase
        .from("ai_coordinator_lead_profiles")
        .select("id")
        .eq("patient_id", patientId)
        .eq("clinic_id", clinicId)
        .maybeSingle();
      profileId = prof?.id ? String(prof.id) : null;
      if (profileId) {
        await supabase
          .from("channel_identities")
          .update({ profile_id: profileId, updated_at: new Date().toISOString() })
          .eq("id", existingIdentity.id);
      }
    }
    if (profileId) {
      await patchProfilePrimaryChannel(profileId, "messenger", {
        channel_metadata: {
          messenger_psid: psid,
          messenger_page_id: pageId,
        },
      });
    }
    return {
      ok: true,
      patientId,
      profileId,
      identityId: existingIdentity.id,
      created: false,
      threadId: workspace.threadId || null,
    };
  }

  let displayName = String(params.displayName || "").trim();
  if (!displayName && params.pageConnectionRow) {
    const token = pageAccessTokenFromRow(params.pageConnectionRow);
    if (token) {
      const profile = await fetchMessengerUserProfile(psid, token);
      if (profile) {
        displayName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
      }
    }
  }
  if (!displayName) displayName = "Messenger User";

  const clinicCode = await getClinicCodeForClinic(clinicId);
  const legacyPatientId = `MSG_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  const nameParts = displayName.split(/\s+/).filter(Boolean);
  const first_name = nameParts[0] || "Messenger";
  const last_name = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

  const patientPayload = {
    clinic_id: clinicId,
    ...(clinicCode ? { clinic_code: clinicCode } : {}),
    patient_id: legacyPatientId,
    name: displayName,
    first_name,
    last_name,
    status: "LEAD",
    is_lead: true,
    source: "messenger",
  };

  const { data: patientRow, error: pErr } = await insertPatientWithPruning(patientPayload);
  if (pErr || !patientRow?.id) {
    console.warn("[channelIdentity] patient create:", pErr?.message || pErr);
    return { ok: false, error: "patient_create_failed" };
  }

  const patientUuid = String(patientRow.id);
  const workspace = await ensureLeadWorkspaceForClinic(patientUuid, clinicId, {
    source: "messenger",
    leadStatus: "inquiry",
  });

  const { data: prof } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("id")
    .eq("patient_id", patientUuid)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  const profileId = prof?.id ? String(prof.id) : null;
  if (profileId) {
    await patchProfilePrimaryChannel(profileId, "messenger", {
      channel_metadata: {
        messenger_psid: psid,
        messenger_page_id: pageId,
      },
      source: "messenger",
    });
  }

  const nowIso = new Date().toISOString();
  const { data: identity, error: idErr } = await supabase
    .from("channel_identities")
    .insert({
      clinic_id: clinicId,
      channel: "messenger",
      external_user_id: psid,
      external_thread_id: `${pageId}:${psid}`,
      patient_id: patientUuid,
      profile_id: profileId,
      display_name: displayName,
      metadata: { page_id: pageId },
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .single();

  if (idErr) {
    console.warn("[channelIdentity] identity insert:", idErr.message);
  }

  console.log("[channelIdentity] messenger lead created", {
    clinicId: clinicId.slice(0, 8),
    patientId: patientUuid.slice(0, 8),
    psid: psid.slice(0, 8),
  });

  return {
    ok: true,
    patientId: patientUuid,
    profileId,
    identityId: identity?.id || null,
    created: true,
    threadId: workspace.threadId || null,
  };
}

module.exports = {
  resolveMessengerIdentity,
};
