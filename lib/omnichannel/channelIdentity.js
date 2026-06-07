/**
 * Channel identity resolution — Messenger PSID → patient + lead profile.
 */

const crypto = require("crypto");
const { supabase, isSupabaseEnabled } = require("../supabase");
const { ensureLeadWorkspaceForClinic } = require("../patientLeadLifecycle");
const { patchProfilePrimaryChannel } = require("../coordinatorChannelPersistence");
const { fetchMessengerUserProfile } = require("./metaGraph");
const { repairConcatenatedPsid } = require("./metaWebhook");
const {
  pageAccessTokenFromRow,
  getActivePageConnectionByPageId,
  getActivePageConnectionForClinic,
} = require("./metaPageConnections");
const {
  normalizePatientDisplayName,
  normalizeMessengerGraphProfileName,
  isPlaceholderPatientName,
  extractPatientNameFromMessage,
  looksLikeStandaloneNameLine,
  syncPatientNameColumn,
  syncPatientNameFromMessengerTurn,
} = require("../patientNameSync");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MIN_TRUSTED_MESSENGER_PSID_LEN = 12;

/**
 * Legacy prefix heuristic — logging only; never used for identity resolution.
 * @param {string} stored
 * @param {string} incoming
 */
function wouldLegacyPrefixMatchPsid(stored, incoming) {
  if (!stored || !incoming || stored === incoming) return false;
  return (
    incoming.startsWith(stored) ||
    stored.startsWith(incoming) ||
    (stored.length < incoming.length && incoming.startsWith(stored))
  );
}

/**
 * Warn when a prior prefix-based lookup would have merged different PSIDs.
 * @param {string} clinicId
 * @param {string} incomingPsid
 * @param {string} [pageId]
 */
async function logMessengerIdentityPrefixCollisions(clinicId, incomingPsid, pageId) {
  const incoming = String(incomingPsid || "").trim();
  if (!incoming) return;

  const { data: rows } = await supabase
    .from("channel_identities")
    .select("external_user_id, metadata")
    .eq("clinic_id", clinicId)
    .eq("channel", "messenger");

  for (const row of rows || []) {
    const matchedPsid = String(row.external_user_id || "").trim();
    if (!matchedPsid || matchedPsid === incoming) continue;
    const metaPage = String(row.metadata?.page_id || "").trim();
    if (pageId && metaPage && metaPage !== pageId) continue;
    if (!wouldLegacyPrefixMatchPsid(matchedPsid, incoming)) continue;
    console.warn(
      "[MESSENGER_IDENTITY_COLLISION]",
      JSON.stringify({
        clinicId: clinicId.slice(0, 8),
        incomingPsid: incoming,
        matchedPsid,
        pageId: pageId || null,
      }),
    );
  }
}

/**
 * Find identity by exact PSID only (channel=messenger, external_user_id=sender.id).
 * @param {string} clinicId
 * @param {string} psid
 * @param {string} rawPsid
 * @param {string} pageId
 */
async function findMessengerIdentityRow(clinicId, psid, rawPsid, pageId) {
  const exactIds = [
    ...new Set([String(psid || "").trim(), String(rawPsid || "").trim()].filter(Boolean)),
  ];

  for (const externalUserId of exactIds) {
    const { data: exact } = await supabase
      .from("channel_identities")
      .select("id, patient_id, profile_id, display_name, external_user_id, metadata")
      .eq("clinic_id", clinicId)
      .eq("channel", "messenger")
      .eq("external_user_id", externalUserId)
      .maybeSingle();
    if (exact?.patient_id) return exact;
  }

  const primaryIncoming = exactIds[0] || "";
  if (primaryIncoming) {
    await logMessengerIdentityPrefixCollisions(clinicId, primaryIncoming, pageId);
  }
  return null;
}

/**
 * Resolve Messenger PSID for outbound send — exact stored identity only.
 * @param {{ clinicId: string, patientId: string, pageId?: string|null, profileId?: string|null }} params
 */
async function resolveMessengerPsidForPatient(params) {
  const clinicId = String(params.clinicId || "").trim();
  const patientId = String(params.patientId || "").trim();
  const pageId = String(params.pageId || "").trim();
  if (!UUID_RE.test(clinicId) || !UUID_RE.test(patientId)) {
    return { psid: null, error: "invalid_params" };
  }

  const { data: identity } = await supabase
    .from("channel_identities")
    .select("id, external_user_id, metadata")
    .eq("clinic_id", clinicId)
    .eq("channel", "messenger")
    .eq("patient_id", patientId)
    .maybeSingle();

  let psid = String(identity?.external_user_id || "").trim();

  if (!psid) {
    const { data: profile } = params.profileId
      ? await supabase
          .from("ai_coordinator_lead_profiles")
          .select("id, channel_metadata")
          .eq("id", params.profileId)
          .maybeSingle()
      : await supabase
          .from("ai_coordinator_lead_profiles")
          .select("id, channel_metadata")
          .eq("patient_id", patientId)
          .eq("clinic_id", clinicId)
          .maybeSingle();
    const meta =
      profile?.channel_metadata && typeof profile.channel_metadata === "object"
        ? profile.channel_metadata
        : {};
    psid = String(meta.messenger_psid || "").trim();
  }

  if (!psid) {
    return { psid: null, error: "messenger_psid_not_found" };
  }

  const repaired = repairConcatenatedPsid(psid, pageId, "");
  psid = repaired || psid;

  if (psid.length < MIN_TRUSTED_MESSENGER_PSID_LEN) {
    return {
      psid,
      error: "messenger_psid_truncated",
      hint:
        "Stored PSID is too short (likely legacy bug). Ask the patient to send a new Messenger message, then retry.",
    };
  }

  return { psid };
}

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
  const out = new Set([digits, `+${digits}`]);
  if (digits.startsWith("995") && digits.length >= 12) {
    out.add(digits.slice(3));
    out.add(`+${digits.slice(3)}`);
  } else if (/^5\d{8}$/.test(digits)) {
    out.add(`995${digits}`);
    out.add(`+995${digits}`);
  }
  return [...out];
}

/**
 * Meta may send wa_id with or without country code — match stored identities.
 * @param {string} clinicId
 * @param {string} waId
 */
async function findWhatsAppIdentityRow(clinicId, waId) {
  const variants = whatsappPhoneVariants(waId);
  for (const v of variants) {
    const id = String(v).replace(/\D/g, "");
    if (!id) continue;
    const { data } = await supabase
      .from("channel_identities")
      .select("id, patient_id, profile_id, display_name, external_user_id, metadata")
      .eq("clinic_id", clinicId)
      .eq("channel", "whatsapp")
      .eq("external_user_id", id)
      .maybeSingle();
    if (data?.patient_id) return { row: data, canonicalWaId: id };
  }
  return null;
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
 *   inboundMessage?: string|null,
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

  const rawPsidParam = String(params.rawPsid || "").trim();
  let existingIdentity = await findMessengerIdentityRow(clinicId, psid, rawPsidParam, pageId);

  if (existingIdentity?.patient_id) {
    const storedPsid = String(existingIdentity.external_user_id || "").trim();
    const incomingPsid = String(psid || "").trim();
    const rawPsid = String(params.rawPsid || "").trim();
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
    const resolvedPsid = storedPsid || incomingPsid;
    if (profileId && resolvedPsid) {
      await patchProfilePrimaryChannel(profileId, "messenger", {
        channel_metadata: {
          messenger_psid: resolvedPsid,
          messenger_page_id: pageId,
          ...(rawPsid && rawPsid !== resolvedPsid ? { messenger_psid_raw: rawPsid } : {}),
        },
      });
    }
    void ensureMessengerPatientNameFromGraph({
      clinicId,
      patientId,
      psid: resolvedPsid,
      pageId,
      pageConnectionRow: params.pageConnectionRow,
      identityId: existingIdentity.id,
      message: params.inboundMessage || null,
    }).catch((e) =>
      console.warn("[channelIdentity] messenger name refresh:", e?.message || e),
    );
    return {
      ok: true,
      patientId,
      profileId,
      identityId: existingIdentity.id,
      created: false,
      threadId: workspace.threadId || null,
    };
  }

  let displayName = normalizePatientDisplayName(params.displayName);
  if (!displayName && params.pageConnectionRow) {
    const token = pageAccessTokenFromRow(params.pageConnectionRow);
    if (token) {
      const profile = await fetchMessengerUserProfile(psid, token, pageId);
      displayName = normalizeMessengerGraphProfileName(profile);
    }
  }
  if (!displayName) {
    const pageRow =
      params.pageConnectionRow || (await getActivePageConnectionByPageId(pageId)) ||
      (await getActivePageConnectionForClinic(clinicId));
    const token = pageRow ? pageAccessTokenFromRow(pageRow) : null;
    if (token) {
      const profile = await fetchMessengerUserProfile(psid, token, pageId);
      displayName = normalizeMessengerGraphProfileName(profile);
    }
  }
  const inboundText = String(params.inboundMessage || "").trim();
  if (!displayName && inboundText && inboundText !== "[message]") {
    displayName =
      extractPatientNameFromMessage(inboundText) ||
      (looksLikeStandaloneNameLine(inboundText) ? normalizePatientDisplayName(inboundText) : null);
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
    external_name: displayName,
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

  if (isPlaceholderPatientName(displayName)) {
    await ensureMessengerPatientNameFromGraph({
      clinicId,
      patientId: patientUuid,
      psid,
      pageId,
      pageConnectionRow: params.pageConnectionRow,
      identityId: identity?.id || null,
    }).catch((e) => console.warn("[channelIdentity] messenger name sync:", e?.message || e));
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

  const foundIdentity = await findWhatsAppIdentityRow(clinicId, waId);
  const existingIdentity = foundIdentity?.row || null;
  const canonicalWaId = foundIdentity?.canonicalWaId || waId;

  if (existingIdentity?.patient_id) {
    const patientId = String(existingIdentity.patient_id);
    const profileName = normalizePatientDisplayName(params.profileName || params.displayName);
    if (profileName) {
      await syncPatientNameColumn(patientId, profileName, { source: "whatsapp_profile" });
      if (profileName !== String(existingIdentity.display_name || "").trim()) {
        await supabase
          .from("channel_identities")
          .update({
            display_name: profileName,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingIdentity.id);
      }
    }
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
          whatsapp_wa_id: canonicalWaId,
          whatsapp_phone_number_id: phoneNumberId,
        },
      });
      if (String(existingIdentity.external_user_id || "") !== canonicalWaId) {
        await supabase
          .from("channel_identities")
          .update({
            external_user_id: canonicalWaId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingIdentity.id);
      }
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
    normalizePatientDisplayName(params.profileName || params.displayName) || "WhatsApp User";
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
    if (!existingPatient.phone) {
      await supabase
        .from("patients")
        .update({ phone: phoneE164, updated_at: new Date().toISOString() })
        .eq("id", existingPatient.id);
    }
    if (displayName !== "WhatsApp User") {
      await syncPatientNameColumn(String(existingPatient.id), displayName, {
        source: "whatsapp_profile",
      });
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
    external_name: displayName,
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

/**
 * Sync Messenger lead display name → patients.name (Graph profile, cached identity, or message).
 * @param {{
 *   clinicId: string,
 *   patientId: string,
 *   psid?: string|null,
 *   pageId?: string|null,
 *   pageConnectionRow?: Record<string, unknown>|null,
 *   identityId?: string|null,
 *   message?: string|null,
 * }} params
 */
async function ensureMessengerPatientNameFromGraph(params) {
  const clinicId = String(params.clinicId || "").trim();
  const patientId = String(params.patientId || "").trim();
  if (!UUID_RE.test(clinicId) || !UUID_RE.test(patientId) || !isSupabaseEnabled()) {
    return { name: null, synced: false };
  }

  let psid = String(params.psid || "").trim();
  let pageId = String(params.pageId || "").trim();
  let identityId = params.identityId ? String(params.identityId) : null;
  let storedDisplay = null;

  const { data: patientRow } = await supabase
    .from("patients")
    .select("name, full_name")
    .eq("id", patientId)
    .maybeSingle();
  const currentName =
    normalizePatientDisplayName(patientRow?.full_name) ||
    normalizePatientDisplayName(patientRow?.name);
  if (currentName && !isPlaceholderPatientName(currentName)) {
    return { name: currentName, synced: false };
  }

  let identQuery = supabase
    .from("channel_identities")
    .select("id, external_user_id, display_name, metadata")
    .eq("patient_id", patientId)
    .eq("clinic_id", clinicId)
    .eq("channel", "messenger");
  if (identityId) {
    identQuery = identQuery.eq("id", identityId);
  } else {
    identQuery = identQuery.order("updated_at", { ascending: false }).limit(1);
  }
  const { data: ident } = await identQuery.maybeSingle();
  if (ident) {
    identityId = identityId || String(ident.id || "");
    psid = psid || String(ident.external_user_id || "").trim();
    storedDisplay = normalizePatientDisplayName(ident.display_name);
    const meta = ident.metadata && typeof ident.metadata === "object" ? ident.metadata : {};
    pageId = pageId || String(meta.page_id || "").trim();
  }

  if (storedDisplay) {
    const synced = await syncPatientNameColumn(patientId, storedDisplay, {
      source: "messenger_identity_cached",
    });
    if (synced.updated) {
      return { name: synced.name, synced: true };
    }
  }

  if (psid) {
    let pageRow = params.pageConnectionRow || null;
    if (!pageRow && pageId) {
      pageRow = await getActivePageConnectionByPageId(pageId);
    }
    if (!pageRow) {
      pageRow = await getActivePageConnectionForClinic(clinicId);
    }
    const token = pageRow ? pageAccessTokenFromRow(pageRow) : null;
    const graphPageId = pageId || String(pageRow?.page_id || "").trim();
    if (token) {
      const profile = await fetchMessengerUserProfile(psid, token, graphPageId);
      const displayName = normalizeMessengerGraphProfileName(profile);
      if (displayName) {
        const synced = await syncPatientNameColumn(patientId, displayName, {
          source: "messenger_graph_profile",
        });
        if (identityId) {
          await supabase
            .from("channel_identities")
            .update({ display_name: displayName, updated_at: new Date().toISOString() })
            .eq("id", identityId);
        }
        if (synced.updated || synced.name) {
          return { name: synced.name || displayName, synced: true };
        }
      }
    }
  }

  let message = String(params.message || "").trim();
  if (!message || message === "[message]") {
    try {
      const { data: prof } = await supabase
        .from("ai_coordinator_lead_profiles")
        .select("last_patient_message")
        .eq("patient_id", patientId)
        .eq("clinic_id", clinicId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      message = String(prof?.last_patient_message || "").trim();
    } catch {
      /* optional */
    }
  }
  if (message && message !== "[message]") {
    const fromTurn = await syncPatientNameFromMessengerTurn(patientId, { message });
    if (fromTurn.updated && fromTurn.name) {
      if (identityId) {
        await supabase
          .from("channel_identities")
          .update({ display_name: fromTurn.name, updated_at: new Date().toISOString() })
          .eq("id", identityId);
      }
      return { name: fromTurn.name, synced: true };
    }
  }

  return { name: currentName || storedDisplay || null, synced: false };
}

/**
 * Inbox / thread-summary: replace "Messenger User" placeholders with Graph names (bounded).
 * @param {string} clinicId
 * @param {string[]} patientIds
 * @param {{ maxGraphSync?: number }} [opts]
 * @returns {Promise<Map<string, string>>}
 */
async function enrichPatientDisplayNamesForInbox(clinicId, patientIds, opts = {}) {
  const cid = String(clinicId || "").trim();
  const ids = [...new Set((patientIds || []).map((x) => String(x || "").trim()).filter((x) => UUID_RE.test(x)))];
  const out = new Map();
  if (!UUID_RE.test(cid) || !ids.length || !isSupabaseEnabled()) return out;

  const maxGraph = Math.min(12, Math.max(0, parseInt(String(opts.maxGraphSync ?? 8), 10) || 8));

  const { data: patients } = await supabase
    .from("patients")
    .select("id, name, full_name, first_name, last_name")
    .in("id", ids.slice(0, 200));
  const needSync = [];
  for (const row of patients || []) {
    const pid = String(row.id || "").trim().toLowerCase();
    const current =
      normalizePatientDisplayName(row.full_name) ||
      normalizePatientDisplayName(row.name) ||
      normalizePatientDisplayName([row.first_name, row.last_name].filter(Boolean).join(" "));
    if (current && !isPlaceholderPatientName(current)) {
      out.set(pid, current);
    } else {
      needSync.push(String(row.id));
    }
  }

  if (!needSync.length) return out;

  const { data: identities } = await supabase
    .from("channel_identities")
    .select("id, patient_id, external_user_id, display_name, metadata")
    .eq("clinic_id", cid)
    .eq("channel", "messenger")
    .in("patient_id", needSync.slice(0, 120));

  const identByPatient = new Map();
  for (const ident of identities || []) {
    const pid = String(ident.patient_id || "").trim().toLowerCase();
    if (!pid) continue;
    const cached = normalizePatientDisplayName(ident.display_name);
    if (cached && !isPlaceholderPatientName(cached)) {
      out.set(pid, cached);
      continue;
    }
    identByPatient.set(pid, ident);
  }

  let graphTries = 0;
  for (const pid of needSync) {
    if (graphTries >= maxGraph) break;
    const key = String(pid).trim().toLowerCase();
    if (out.has(key)) continue;
    const ident = identByPatient.get(key);
    if (!ident) continue;
    const meta = ident.metadata && typeof ident.metadata === "object" ? ident.metadata : {};
    const pageId = String(meta.page_id || "").trim();
    const psid = String(ident.external_user_id || "").trim();
    if (!psid) continue;
    graphTries += 1;
    try {
      const r = await ensureMessengerPatientNameFromGraph({
        clinicId: cid,
        patientId: pid,
        psid,
        pageId,
        identityId: ident.id,
      });
      const name = normalizePatientDisplayName(r?.name);
      if (name) out.set(key, name);
    } catch (e) {
      console.warn("[channelIdentity] inbox name enrich:", e?.message || e);
    }
  }

  return out;
}

module.exports = {
  resolveMessengerPsidForPatient,
  resolveMessengerIdentity,
  ensureMessengerPatientNameFromGraph,
  enrichPatientDisplayNamesForInbox,
  resolveWhatsAppIdentity,
  findPatientByWhatsAppPhone,
  whatsappPhoneVariants,
};
