/**
 * Doctor chat message translation — cache on patient_messages.translation, reuse per target language.
 */

const { supabase, isSupabaseEnabled } = require("./supabase");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUPPORTED_DOCTOR_CHAT_LANGS = new Set(["tr", "en", "ka", "ru", "de", "fr", "ar"]);

const LANG_LABELS = {
  tr: "Turkish",
  en: "English",
  ka: "Georgian",
  ru: "Russian",
  de: "German",
  fr: "French",
  ar: "Arabic",
};

const CHAT_TRANSLATE_SYSTEM = `You are a professional medical translator for clinic patient–doctor chat messages.

Translate accurately. Preserve tone, names, dates, phone numbers, and medical terms when appropriate.

Respond with valid JSON only (no markdown):
{"sourceLanguage":"xx","translatedText":"..."}

Rules:
- sourceLanguage: ISO 639-1 code of the ORIGINAL message (best guess).
- translatedText: full translation in the requested target language.
- If the message is already in the target language, set translatedText to the original text and sourceLanguage to the target code.`;

/**
 * @param {string|null|undefined} input
 */
function normalizeDoctorChatLang(input) {
  const raw = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (!raw) return "en";
  const two = raw.slice(0, 2);
  if (SUPPORTED_DOCTOR_CHAT_LANGS.has(two)) return two;
  if (raw.startsWith("tr") || raw.includes("turk")) return "tr";
  if (raw.startsWith("en") || raw.includes("english")) return "en";
  if (raw.startsWith("ka") || raw.includes("georg")) return "ka";
  if (raw.startsWith("ru") || raw.includes("russian")) return "ru";
  if (raw.startsWith("de") || raw.includes("german")) return "de";
  if (raw.startsWith("fr") || raw.includes("french")) return "fr";
  if (raw.startsWith("ar") || raw.includes("arabic")) return "ar";
  return "en";
}

/**
 * @param {unknown} raw
 */
function parseTranslationStore(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { byTarget: {} };
  }
  const obj = /** @type {Record<string, unknown>} */ (raw);
  if (obj.byTarget && typeof obj.byTarget === "object" && !Array.isArray(obj.byTarget)) {
    return { byTarget: /** @type {Record<string, unknown>} */ (obj.byTarget) };
  }
  if (obj.translatedText && obj.targetLanguage) {
    const target = normalizeDoctorChatLang(String(obj.targetLanguage));
    return {
      byTarget: {
        [target]: obj,
      },
    };
  }
  return { byTarget: {} };
}

/**
 * @param {Record<string, unknown>|null|undefined} store
 * @param {string} targetLang
 */
function getCachedTranslationEntry(store, targetLang) {
  const parsed = parseTranslationStore(store);
  const key = normalizeDoctorChatLang(targetLang);
  const entry = parsed.byTarget[key];
  if (!entry || typeof entry !== "object") return null;
  const translatedText = String(
    /** @type {Record<string, unknown>} */ (entry).translatedText || "",
  ).trim();
  if (!translatedText) return null;
  return {
    sourceLanguage: normalizeDoctorChatLang(
      String(/** @type {Record<string, unknown>} */ (entry).sourceLanguage || "auto"),
    ),
    targetLanguage: key,
    translatedText,
    translatedAt: String(
      /** @type {Record<string, unknown>} */ (entry).translatedAt || "",
    ).trim(),
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} store
 * @param {{ sourceLanguage: string, targetLanguage: string, translatedText: string, translatedAt: string }} entry
 */
function mergeTranslationStore(store, entry) {
  const parsed = parseTranslationStore(store);
  const key = normalizeDoctorChatLang(entry.targetLanguage);
  parsed.byTarget[key] = {
    sourceLanguage: normalizeDoctorChatLang(entry.sourceLanguage),
    targetLanguage: key,
    translatedText: String(entry.translatedText || "").trim(),
    translatedAt: entry.translatedAt || new Date().toISOString(),
  };
  return parsed;
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} [targetLang]
 */
function pickTranslationForLegacyMessage(row, targetLang) {
  if (!row || !targetLang) return null;
  const cached = getCachedTranslationEntry(row.translation, targetLang);
  if (!cached) return null;
  return cached;
}

/**
 * @param {import('express').Request} req
 * @param {string} [doctorRowPreferred]
 */
function resolveDoctorPreferredLanguageFromRequest(req, doctorRowPreferred) {
  const fromRow = normalizeDoctorChatLang(doctorRowPreferred);
  if (doctorRowPreferred && String(doctorRowPreferred).trim()) return fromRow;
  const header =
    req.headers["x-ui-language"] ||
    req.headers["x-lang"] ||
    req.headers["accept-language"] ||
    "";
  const first = String(header).split(",")[0].trim();
  return normalizeDoctorChatLang(first || "en");
}

/**
 * @param {string} doctorId
 * @param {string} language
 */
async function persistDoctorPreferredLanguage(doctorId, language) {
  if (!isSupabaseEnabled() || !UUID_RE.test(String(doctorId || ""))) {
    return { ok: false, error: "invalid_doctor" };
  }
  const lang = normalizeDoctorChatLang(language);
  const { error } = await supabase
    .from("doctors")
    .update({ preferred_language: lang, updated_at: new Date().toISOString() })
    .eq("id", doctorId);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, preferredLanguage: lang };
}

function isMissingColumnError(err) {
  const code = String(err?.code || "");
  return ["42703", "PGRST204", "PGRST205"].includes(code);
}

function coordinatorChannelRoleIsPatient(messageRole) {
  const r = String(messageRole || "").toLowerCase();
  return r === "patient" || r === "user" || r === "human" || r === "lead";
}

/**
 * @param {string|null|undefined} profileId
 */
async function resolvePatientIdFromCoordinatorProfile(profileId) {
  const pid = String(profileId || "").trim();
  if (!UUID_RE.test(pid)) return "";
  const { data } = await supabase
    .from("ai_coordinator_lead_profiles")
    .select("patient_id")
    .eq("id", pid)
    .maybeSingle();
  return String(data?.patient_id || "").trim();
}

/**
 * WhatsApp/Messenger coordinator legs use synthetic ids (coord_ch_*, coord_ev_*_p).
 * @param {string} messageId
 */
async function loadCoordinatorMessageByPublicId(messageId) {
  const id = String(messageId || "").trim();
  if (!id || !isSupabaseEnabled()) return null;

  if (id.startsWith("coord_ch_")) {
    const rowId = id.slice("coord_ch_".length);
    if (!UUID_RE.test(rowId)) return null;

    const selects = [
      "id, profile_id, body, message_role, metadata, created_at",
      "id, profile_id, body, message_role, created_at",
    ];
    for (const sel of selects) {
      const { data, error } = await supabase
        .from("ai_coordinator_channel_messages")
        .select(sel)
        .eq("id", rowId)
        .maybeSingle();
      if (error) {
        if (isMissingColumnError(error)) continue;
        console.warn("[doctorChatTranslation] coord_ch load:", error.message);
        return null;
      }
      if (!data) continue;
      if (!coordinatorChannelRoleIsPatient(data.message_role)) return null;

      const patientId = await resolvePatientIdFromCoordinatorProfile(data.profile_id);
      const meta =
        data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
          ? data.metadata
          : {};
      const body = String(data.body || "").trim();
      if (!body) return null;

      return {
        id,
        coordinatorSource: "channel",
        coordinatorRowId: rowId,
        patient_id: patientId,
        body,
        text: body,
        translation: meta.translation || null,
        from_role: "patient",
      };
    }
    return null;
  }

  if (id.startsWith("coord_ev_") && id.endsWith("_p")) {
    const eventId = id.slice("coord_ev_".length, -2);
    if (!UUID_RE.test(eventId)) return null;

    const selects = [
      "id, profile_id, patient_message, created_at",
      "id, profile_id, patient_message, metadata, created_at",
    ];
    for (const sel of selects) {
      const { data, error } = await supabase
        .from("ai_coordinator_lead_events")
        .select(sel)
        .eq("id", eventId)
        .maybeSingle();
      if (error) {
        if (isMissingColumnError(error)) continue;
        console.warn("[doctorChatTranslation] coord_ev load:", error.message);
        return null;
      }
      if (!data) continue;

      const body = String(data.patient_message || "").trim();
      if (!body) return null;

      const patientId = await resolvePatientIdFromCoordinatorProfile(data.profile_id);
      const meta =
        data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
          ? data.metadata
          : {};

      return {
        id,
        coordinatorSource: "event",
        coordinatorRowId: eventId,
        patient_id: patientId,
        body,
        text: body,
        translation: meta.translation || null,
        from_role: "patient",
      };
    }
  }

  return null;
}

/**
 * @param {Record<string, unknown>} row
 * @param {ReturnType<typeof mergeTranslationStore>} nextStore
 */
async function persistTranslationForRow(row, nextStore) {
  if (row.coordinatorSource === "channel" && row.coordinatorRowId) {
    const rowId = String(row.coordinatorRowId);
    const { data: existing } = await supabase
      .from("ai_coordinator_channel_messages")
      .select("metadata")
      .eq("id", rowId)
      .maybeSingle();
    const meta =
      existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
        ? { ...existing.metadata }
        : {};
    meta.translation = nextStore;
    const { error } = await supabase
      .from("ai_coordinator_channel_messages")
      .update({ metadata: meta })
      .eq("id", rowId);
    if (error) {
      console.warn("[doctorChatTranslation] coord_ch persist:", error.message);
    }
    return;
  }

  if (row.coordinatorSource === "event" && row.coordinatorRowId) {
    const rowId = String(row.coordinatorRowId);
    const { data: existing } = await supabase
      .from("ai_coordinator_lead_events")
      .select("metadata")
      .eq("id", rowId)
      .maybeSingle();
    if (existing && "metadata" in existing) {
      const meta =
        existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
          ? { ...existing.metadata }
          : {};
      meta.translation = nextStore;
      const { error } = await supabase
        .from("ai_coordinator_lead_events")
        .update({ metadata: meta })
        .eq("id", rowId);
      if (error) {
        console.warn("[doctorChatTranslation] coord_ev persist:", error.message);
      }
    }
    return;
  }

  if (row.storageTable === "messages" && row.id) {
    const { error } = await supabase
      .from("messages")
      .update({ translation: nextStore })
      .eq("id", row.id);
    if (error) {
      if (isMissingColumnError(error)) {
        console.warn("[doctorChatTranslation] messages.translation column missing — cache skipped");
      } else {
        console.warn("[doctorChatTranslation] messages persist:", error.message);
      }
    }
    return;
  }

  const rowPk = row.id;
  if (!rowPk) return;
  const { error } = await supabase
    .from("patient_messages")
    .update({ translation: nextStore })
    .eq("id", rowPk);
  if (error) {
    if (isMissingColumnError(error)) {
      console.warn(
        "[doctorChatTranslation] patient_messages.translation missing — apply migration 20260531140000",
      );
    } else {
      console.warn("[doctorChatTranslation] patient_messages persist:", error.message);
    }
  }
}

/**
 * @param {string} messageId
 */
async function loadPatientMessageByPublicId(messageId) {
  const id = String(messageId || "").trim();
  if (!id || !isSupabaseEnabled()) return null;

  const coord = await loadCoordinatorMessageByPublicId(id);
  if (coord) return coord;

  const selects = [
    "id, message_id, patient_id, clinic_id, thread_id, text, message, message_text, content, body, translation, from_role, created_at",
    "id, message_id, patient_id, clinic_id, thread_id, text, message, message_text, content, body, from_role, created_at",
  ];

  for (const sel of selects) {
    const byUuid = await supabase.from("patient_messages").select(sel).eq("id", id).maybeSingle();
    if (byUuid.error) {
      if (isMissingColumnError(byUuid.error)) continue;
      console.warn("[doctorChatTranslation] load by id:", byUuid.error.message);
    } else if (byUuid.data) {
      return { ...byUuid.data, storageTable: "patient_messages" };
    }

    const byMessageId = await supabase
      .from("patient_messages")
      .select(sel)
      .eq("message_id", id)
      .maybeSingle();
    if (byMessageId.error) {
      if (isMissingColumnError(byMessageId.error)) continue;
      console.warn("[doctorChatTranslation] load by message_id:", byMessageId.error.message);
    } else if (byMessageId.data) {
      return { ...byMessageId.data, storageTable: "patient_messages" };
    }
  }

  const legacy = await loadLegacyMessageFromMessagesTable(id);
  if (legacy) return legacy;

  return null;
}

function extractMessageBody(row) {
  if (!row || typeof row !== "object") return "";
  const keyOrder = [
    "text",
    "message",
    "content",
    "message_text",
    "body",
    "msg",
    "note",
    "notes",
    "caption",
    "plain_text",
    "message_body",
    "description",
  ];
  for (const k of keyOrder) {
    if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
    const v = row[k];
    if (v == null) continue;
    const s = typeof v === "string" ? v.trim() : String(v).trim();
    if (s) return s;
  }
  for (const nestedKey of ["payload", "data"]) {
    const raw = row[nestedKey];
    if (raw == null) continue;
    try {
      const p = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (p && typeof p === "object") {
        for (const k of ["text", "message", "body", "content"]) {
          const v = p[k];
          if (v != null && String(v).trim()) return String(v).trim();
        }
      }
    } catch {
      /* ignore */
    }
  }
  return "";
}

/**
 * Legacy `messages` table rows (UUID id) shown in unified doctor chat.
 * @param {string} messageId
 */
async function loadLegacyMessageFromMessagesTable(messageId) {
  const id = String(messageId || "").trim();
  if (!id || !UUID_RE.test(id) || !isSupabaseEnabled()) return null;

  const selects = [
    "id, patient_id, clinic_id, thread_id, text, message, message_text, content, body, translation, sender, sender_type, from_role, created_at",
    "id, patient_id, clinic_id, text, message, message_text, content, body, translation, sender, sender_type, from_role, created_at",
    "id, patient_id, text, message, content, body, sender, created_at",
  ];

  for (const sel of selects) {
    const { data, error } = await supabase.from("messages").select(sel).eq("id", id).maybeSingle();
    if (error) {
      if (isMissingColumnError(error)) continue;
      console.warn("[doctorChatTranslation] messages load:", error.message);
      return null;
    }
    if (!data) continue;

    const senderRaw =
      data.sender ??
      data.sender_type ??
      data.from_role ??
      (data.from_patient !== undefined ? (data.from_patient ? "patient" : "clinic") : "");
    const sender = String(senderRaw || "").toLowerCase();
    if (sender && sender !== "patient" && sender !== "user" && sender !== "human") {
      return null;
    }

    return { ...data, storageTable: "messages" };
  }

  return null;
}

/**
 * @param {string} text
 * @param {string} targetLang
 * @param {{ apiKey?: string, timeoutMs?: number }} [opts]
 */
async function translateChatMessageText(text, targetLang, opts = {}) {
  const source = String(text || "").trim();
  const target = normalizeDoctorChatLang(targetLang);
  if (!source) {
    return { sourceLanguage: target, targetLanguage: target, translatedText: "" };
  }
  if (!opts.apiKey) {
    return { sourceLanguage: "auto", targetLanguage: target, translatedText: source };
  }

  const targetName = LANG_LABELS[target] || target;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: CHAT_TRANSLATE_SYSTEM },
        {
          role: "user",
          content: `Target language: ${targetName} (${target})\n\nMessage:\n${source}`,
        },
      ],
      max_tokens: 900,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(Math.min(opts.timeoutMs || 25000, 60000)),
  });

  if (!res.ok) {
    throw new Error(`translate_failed_${res.status}`);
  }

  const data = await res.json().catch(() => ({}));
  const raw = data?.choices?.[0]?.message?.content;
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(String(raw)) : null;
  } catch {
    parsed = null;
  }

  const translatedText = String(parsed?.translatedText || raw || source).trim() || source;
  const sourceLanguage = normalizeDoctorChatLang(parsed?.sourceLanguage || "auto");

  return {
    sourceLanguage,
    targetLanguage: target,
    translatedText,
  };
}

/**
 * @param {{
 *   messageId: string,
 *   targetLang: string,
 *   openaiKey?: string,
 *   assertAccess?: () => Promise<{ ok: boolean, status?: number, error?: string }>,
 * }} params
 */
async function translateDoctorChatMessage(params) {
  const messageId = String(params.messageId || "").trim();
  const targetLang = normalizeDoctorChatLang(params.targetLang);
  if (!messageId) {
    return { ok: false, status: 400, error: "message_id_required" };
  }
  if (!isSupabaseEnabled()) {
    return { ok: false, status: 500, error: "supabase_disabled" };
  }

  const row = await loadPatientMessageByPublicId(messageId);
  if (!row) {
    return { ok: false, status: 404, error: "message_not_found" };
  }

  if (typeof params.assertAccess === "function") {
    const access = await params.assertAccess(row);
    if (!access?.ok) {
      return {
        ok: false,
        status: access.status || 403,
        error: access.error || "forbidden",
      };
    }
  }

  const body = extractMessageBody(row);
  if (!body) {
    return { ok: false, status: 400, error: "empty_message" };
  }

  const cached = getCachedTranslationEntry(row.translation, targetLang);
  if (cached?.translatedText) {
    return {
      ok: true,
      cached: true,
      messageId: String(row.message_id || row.id),
      translation: cached,
    };
  }

  let translated;
  try {
    translated = await translateChatMessageText(body, targetLang, {
      apiKey: params.openaiKey,
    });
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: "translate_provider_failed",
      detail: e?.message || "translate_failed",
    };
  }

  const entry = {
    sourceLanguage: translated.sourceLanguage,
    targetLanguage: targetLang,
    translatedText: translated.translatedText,
    translatedAt: new Date().toISOString(),
  };

  if (!entry.translatedText) {
    return { ok: false, status: 502, error: "empty_translation" };
  }

  const nextStore = mergeTranslationStore(row.translation, entry);
  await persistTranslationForRow(row, nextStore);

  return {
    ok: true,
    cached: false,
    messageId: String(row.message_id || row.id),
    translation: entry,
  };
}

module.exports = {
  SUPPORTED_DOCTOR_CHAT_LANGS,
  LANG_LABELS,
  normalizeDoctorChatLang,
  parseTranslationStore,
  getCachedTranslationEntry,
  pickTranslationForLegacyMessage,
  resolveDoctorPreferredLanguageFromRequest,
  persistDoctorPreferredLanguage,
  loadPatientMessageByPublicId,
  translateDoctorChatMessage,
};
