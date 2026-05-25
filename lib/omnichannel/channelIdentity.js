/**
 * Channel identity resolution — Messenger PSID → patient + lead profile.
 */

const crypto = require("crypto");
const { supabase, isSupabaseEnabled } = require("../supabase");
const { ensureLeadWorkspaceForClinic } = require("../patientLeadLifecycle");
const { patchProfilePrimaryChannel } = require("../coordinatorChannelPersistence");
const { fetchMessengerUserProfile } = require("./metaGraph");
const { repairConcatenatedPsid } = require("./metaWebhook");
const { pageAccessTokenFromRow } = require("./metaPageConnections");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingColumnError(error) {
  const c = String(error?.code || "");
  const m = String(error?.message || "").toLowerCase();
  return (
    ["42703", "PGRST204", "PGRST205"].includes(c) ||
    (m.includes("column") && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes("column"))
  );
}

function isUniqueViolation(error) {
  return String(error?.code || "") === "23505";
}

function isPhoneUniqueViolation(error) {
  const m = String(error?.message || "").toLowerCase();
  return isUniqueViolation(error) && (m.includes("patients_phone_unique") || m.includes("phone"));
}

/**
 * @param {string} waId
 */
function whatsappPhoneVariants(waId) {
  const digits = String(waId || "").replace(/\D/g, "");
  if (!digits) return [];
  return [...new Set([digits, `+${digits}`])];
}

/**
 * Reuse an existing patient row when the same phone already exists (app signup, prior lead, etc.).
 * @param {string} waId
 * @param {string} [clinicId]
 */
async function findPatientByWhatsAppPhone(waId, clinicId) {
  const variants = whatsappPhoneVariants(waId);
  if (!variants.length) return null;

  const orPhone = variants.map((p) => `phone.eq.${p}`).join(",");
  const { data: byPhone, error: phoneErr } = await supabase
    .from("patients")
    .select("id, clinic_id, phone, name, first_name, last_name")
    .or(orPhone)
    .limit(10);

  if (phoneErr && !isMissingColumnError(phoneErr)) {
    console.warn("[channelIdentity] find by phone:", phoneErr.message);
  }

  const rows = byPhone || [];

  if (!rows.length) return null;
  if (clinicId && UUID_RE.test(clinicId)) {
    const sameClinic = rows.find((r) => String(r.clinic_id || "") === clinicId);
    if (sameClinic) return sameClinic;
  }
  return rows[0];
}

function getMissingColumnName(error) {
  const m = String(error?.message || "");
  const quoted = m.match(/column ['"]?([^'"]+)['"]?/i);
  if (quoted?.[1]) return quoted[1].replace(/^patients\./, "");
  const cache = m.match(/Could not find the ['"]([^'"]+)['"] column/i);
  if (cache?.[1]) return cache[1];
  const ofTable = m.match(/Could not find the ['"]([^'"]+)['"] column of ['"]?patients['"]?/i);
  return ofTable?.[1] || null;
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
  const pageId = String(params.pageId || "").trim();
  const psid = repairConcatenatedPsid(String(params.psid || "").trim(), pageId, "");
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
      const profile = await fetchMessengerUserProfile(psid, token, pageId);
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
    status: "PENDING",
    is_lead: true,
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

/**
 * @param {string} patientUuid
 * @param {{
 *   clinicId: string,
 *   waId: string,
 *   phoneNumberId: string,
 *   displayName: string,
 *   created: boolean,
 * }} ctx
 */
async function finalizeWhatsAppIdentityForPatient(patientUuid, ctx) {
  const { clinicId, waId, phoneNumberId, displayName, created } = ctx;
  const workspace = await ensureLeadWorkspaceForClinic(patientUuid, clinicId, {
    source: "whatsapp",
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
    await patchProfilePrimaryChannel(profileId, "whatsapp", {
      channel_metadata: {
        whatsapp_wa_id: waId,
        whatsapp_phone_number_id: phoneNumberId,
      },
      source: "whatsapp",
    });
  }

  const nowIso = new Date().toISOString();
  const { data: existingIdentity } = await supabase
    .from("channel_identities")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("channel", "whatsapp")
    .eq("external_user_id", waId)
    .maybeSingle();

  let identityId = existingIdentity?.id ? String(existingIdentity.id) : null;
  if (!identityId) {
    const { data: identity, error: idErr } = await supabase
      .from("channel_identities")
      .insert({
        clinic_id: clinicId,
        channel: "whatsapp",
        external_user_id: waId,
        external_thread_id: `${phoneNumberId}:${waId}`,
        patient_id: patientUuid,
        profile_id: profileId,
        display_name: displayName,
        metadata: { phone_number_id: phoneNumberId },
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .single();

    if (idErr) {
      if (isUniqueViolation(idErr)) {
        const { data: raced } = await supabase
          .from("channel_identities")
          .select("id, patient_id, profile_id")
          .eq("clinic_id", clinicId)
          .eq("channel", "whatsapp")
          .eq("external_user_id", waId)
          .maybeSingle();
        identityId = raced?.id ? String(raced.id) : null;
      } else {
        console.warn("[channelIdentity] whatsapp identity insert:", idErr.message);
      }
    } else {
      identityId = identity?.id ? String(identity.id) : null;
    }
  } else {
    await supabase
      .from("channel_identities")
      .update({
        patient_id: patientUuid,
        profile_id: profileId,
        display_name: displayName,
        updated_at: nowIso,
      })
      .eq("id", identityId);
  }

  if (created) {
    console.log("[channelIdentity] whatsapp lead created", {
      clinicId: clinicId.slice(0, 8),
      patientId: patientUuid.slice(0, 8),
      waId: waId.slice(0, 12),
    });
  }

  return {
    ok: true,
    patientId: patientUuid,
    profileId,
    identityId,
    created,
    threadId: workspace.threadId || null,
  };
}

/**
 * @param {{
 *   clinicId: string,
 *   waId: string,
 *   phoneNumberId: string,
 *   displayName?: string,
 *   profileName?: string,
 * }} params
 */
async function resolveWhatsAppIdentity(params) {
  if (!isSupabaseEnabled()) return { ok: false, error: "supabase_disabled" };

  const clinicId = String(params.clinicId || "").trim();
  const waId = String(params.waId || "").trim().replace(/\D/g, "");
  const phoneNumberId = String(params.phoneNumberId || "").trim();
  if (!UUID_RE.test(clinicId) || !waId || !phoneNumberId) {
    return { ok: false, error: "invalid_params" };
  }

  const { data: existingIdentity } = await supabase
    .from("channel_identities")
    .select("id, patient_id, profile_id, display_name")
    .eq("clinic_id", clinicId)
    .eq("channel", "whatsapp")
    .eq("external_user_id", waId)
    .maybeSingle();

  if (existingIdentity?.patient_id) {
    const patientId = String(existingIdentity.patient_id);
    const workspace = await ensureLeadWorkspaceForClinic(patientId, clinicId, {
      source: "whatsapp",
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
      await patchProfilePrimaryChannel(profileId, "whatsapp", {
        channel_metadata: {
          whatsapp_wa_id: waId,
          whatsapp_phone_number_id: phoneNumberId,
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

  let displayName =
    String(params.profileName || params.displayName || "").trim() || "WhatsApp User";
  const phoneE164 = waId.startsWith("+") ? waId : `+${waId}`;

  const existingPatient = await findPatientByWhatsAppPhone(waId, clinicId);
  if (existingPatient?.id) {
    console.log("[channelIdentity] whatsapp reusing patient by phone", {
      clinicId: clinicId.slice(0, 8),
      patientId: String(existingPatient.id).slice(0, 8),
      waId: waId.slice(0, 12),
      patientClinicId: existingPatient.clinic_id
        ? String(existingPatient.clinic_id).slice(0, 8)
        : null,
    });
    const patch = { updated_at: new Date().toISOString() };
    if (!existingPatient.phone) patch.phone = phoneE164;
    if (!existingPatient.name && displayName !== "WhatsApp User") patch.name = displayName;
    if (Object.keys(patch).length > 1) {
      await supabase.from("patients").update(patch).eq("id", existingPatient.id);
    }
    return finalizeWhatsAppIdentityForPatient(String(existingPatient.id), {
      clinicId,
      waId,
      phoneNumberId,
      displayName,
      created: false,
    });
  }

  const clinicCode = await getClinicCodeForClinic(clinicId);
  const legacyPatientId = `WA_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  const nameParts = displayName.split(/\s+/).filter(Boolean);
  const first_name = nameParts[0] || "WhatsApp";
  const last_name = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

  const patientPayload = {
    clinic_id: clinicId,
    ...(clinicCode ? { clinic_code: clinicCode } : {}),
    patient_id: legacyPatientId,
    name: displayName,
    first_name,
    last_name,
    phone: phoneE164,
    status: "PENDING",
    is_lead: true,
  };

  let patientUuid = null;
  const { data: patientRow, error: pErr } = await insertPatientWithPruning(patientPayload);
  if (pErr || !patientRow?.id) {
    if (isPhoneUniqueViolation(pErr)) {
      const reused = await findPatientByWhatsAppPhone(waId, clinicId);
      if (reused?.id) {
        console.log("[channelIdentity] whatsapp patient duplicate → linked existing", {
          waId: waId.slice(0, 12),
          patientId: String(reused.id).slice(0, 8),
        });
        return finalizeWhatsAppIdentityForPatient(String(reused.id), {
          clinicId,
          waId,
          phoneNumberId,
          displayName,
          created: false,
        });
      }
    }
    console.warn("[channelIdentity] whatsapp patient create:", pErr?.message || pErr);
    return { ok: false, error: "patient_create_failed" };
  }

  patientUuid = String(patientRow.id);
  return finalizeWhatsAppIdentityForPatient(patientUuid, {
    clinicId,
    waId,
    phoneNumberId,
    displayName,
    created: true,
  });
}

module.exports = {
  resolveMessengerIdentity,
  resolveWhatsAppIdentity,
};
