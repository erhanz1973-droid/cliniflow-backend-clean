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

/**
 * Prefer the longest numeric PSID when healing truncated webhook ids.
 * @param {...string} candidates
 */
function pickBestMessengerPsid(...candidates) {
  const numeric = [...new Set(candidates.map((c) => String(c || "").trim()).filter(Boolean))].filter(
    (id) => /^\d{6,20}$/.test(id),
  );
  if (!numeric.length) return "";
  numeric.sort((a, b) => b.length - a.length);
  return numeric[0];
}

const MIN_TRUSTED_MESSENGER_PSID_LEN = 12;

/**
 * Find identity by exact PSID or heal truncated stored id (8-digit bug).
 * @param {string} clinicId
 * @param {string} psid
 * @param {string} rawPsid
 * @param {string} pageId
 */
async function findMessengerIdentityRow(clinicId, psid, rawPsid, pageId) {
  const { data: exact } = await supabase
    .from("channel_identities")
    .select("id, patient_id, profile_id, display_name, external_user_id, metadata")
    .eq("clinic_id", clinicId)
    .eq("channel", "messenger")
    .eq("external_user_id", psid)
    .maybeSingle();
  if (exact?.patient_id) return exact;

  const bestIncoming = pickBestMessengerPsid(psid, rawPsid);
  if (!bestIncoming) return null;

  const { data: rows } = await supabase
    .from("channel_identities")
    .select("id, patient_id, profile_id, display_name, external_user_id, metadata")
    .eq("clinic_id", clinicId)
    .eq("channel", "messenger");

  for (const row of rows || []) {
    const stored = String(row.external_user_id || "").trim();
    if (!stored) continue;
    const metaPage = String(row.metadata?.page_id || "").trim();
    if (pageId && metaPage && metaPage !== pageId) continue;
    if (
      stored === bestIncoming ||
      bestIncoming.startsWith(stored) ||
      stored.startsWith(bestIncoming) ||
      (stored.length < bestIncoming.length && bestIncoming.startsWith(stored))
    ) {
      return row;
    }
  }
  return null;
}

/**
 * Resolve best Messenger PSID for outbound send (heals truncated DB values).
 * @param {{ clinicId: string, patientId: string, pageId?: string|null, profileId?: string|null }} params
 */
async function resolveMessengerPsidForPatient(params) {
  const clinicId = String(params.clinicId || "").trim();
  const patientId = String(params.patientId || "").trim();
  const pageId = String(params.pageId || "").trim();
  if (!UUID_RE.test(clinicId) || !UUID_RE.test(patientId)) {
    return { psid: null, error: "invalid_params" };
  }

  /** @type {string[]} */
  const candidates = [];

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
  if (meta.messenger_psid_raw) candidates.push(String(meta.messenger_psid_raw));
  if (meta.messenger_psid) candidates.push(String(meta.messenger_psid));

  const { data: identity } = await supabase
    .from("channel_identities")
    .select("id, external_user_id, metadata")
    .eq("clinic_id", clinicId)
    .eq("channel", "messenger")
    .eq("patient_id", patientId)
    .maybeSingle();

  if (identity?.external_user_id) candidates.push(String(identity.external_user_id));
  if (identity?.metadata?.psid) candidates.push(String(identity.metadata.psid));

  const profileId = profile?.id ? String(profile.id) : params.profileId || null;
  if (profileId) {
    const { data: inboundRows } = await supabase
      .from("ai_coordinator_channel_messages")
      .select("metadata")
      .eq("profile_id", profileId)
      .eq("channel", "messenger")
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(8);
    for (const row of inboundRows || []) {
      const m = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      if (m.psid_raw) candidates.push(String(m.psid_raw));
      if (m.psid) candidates.push(String(m.psid));
    }
  }

  const best = pickBestMessengerPsid(...candidates);
  if (!best) {
    return { psid: null, error: "messenger_psid_not_found" };
  }

  const repaired = repairConcatenatedPsid(best, pageId, "");
  const psid = repaired || best;

  if (identity?.id && psid !== String(identity.external_user_id || "")) {
    const nowIso = new Date().toISOString();
    await supabase
      .from("channel_identities")
      .update({ external_user_id: psid, updated_at: nowIso })
      .eq("id", identity.id);
    console.log("[channelIdentity] outbound psid healed", {
      patientId: patientId.slice(0, 8),
      from: String(identity.external_user_id || "").slice(0, 12),
      to: psid.length > 12 ? `${psid.slice(0, 12)}…` : psid,
    });
  }

  if (profileId && psid) {
    await patchProfilePrimaryChannel(profileId, "messenger", {
      channel_metadata: {
        messenger_psid: psid,
        messenger_page_id: pageId || meta.messenger_page_id || null,
        ...(best !== psid ? { messenger_psid_raw: best } : {}),
      },
    });
  }

  if (psid.length < MIN_TRUSTED_MESSENGER_PSID_LEN) {
    return {
      psid,
      error: "messenger_psid_truncated",
      hint:
        "Stored PSID is too short (likely legacy bug). Ask the patient to send a new Messenger message, then retry.",
      candidates: candidates.map((c) => (c.length > 8 ? `${c.slice(0, 8)}…` : c)),
    };
  }

  return { psid, healed: psid !== pickBestMessengerPsid(...candidates.slice(0, 2)) };
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
    const bestPsid = pickBestMessengerPsid(storedPsid, incomingPsid, rawPsid);
    if (bestPsid && bestPsid !== storedPsid) {
      const nowHeal = new Date().toISOString();
      await supabase
        .from("channel_identities")
        .update({ external_user_id: bestPsid, updated_at: nowHeal })
        .eq("id", existingIdentity.id);
      console.log("[channelIdentity] messenger psid healed", {
        clinicId: clinicId.slice(0, 8),
        from: storedPsid.length > 8 ? `${storedPsid.slice(0, 8)}…` : storedPsid,
        to: bestPsid.length > 12 ? `${bestPsid.slice(0, 12)}…` : bestPsid,
      });
    }
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
    const resolvedPsid = bestPsid || incomingPsid || storedPsid;
    if (profileId) {
      await patchProfilePrimaryChannel(profileId, "messenger", {
        channel_metadata: {
          messenger_psid: resolvedPsid,
          messenger_page_id: pageId,
          ...(rawPsid && rawPsid !== resolvedPsid ? { messenger_psid_raw: rawPsid } : {}),
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

  const foundIdentity = await findWhatsAppIdentityRow(clinicId, waId);
  const existingIdentity = foundIdentity?.row || null;
  const canonicalWaId = foundIdentity?.canonicalWaId || waId;

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
  pickBestMessengerPsid,
  resolveMessengerPsidForPatient,
  resolveMessengerIdentity,
  resolveWhatsAppIdentity,
};
