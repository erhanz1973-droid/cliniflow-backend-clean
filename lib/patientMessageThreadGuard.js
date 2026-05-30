/**
 * Hard guard: patient-facing message rows must carry patient_id, clinic_id, thread_id.
 */

const { getCanonicalThread, CANONICAL_THREAD_READ_OPTS } = require("./canonicalChatThread");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {Record<string, unknown>} payload
 */
function logMessageThreadMissing(payload) {
  try {
    console.warn(
      "[MESSAGE_THREAD_MISSING]",
      JSON.stringify({
        at: new Date().toISOString(),
        ...payload,
      }),
    );
  } catch (_) {
    /* non-fatal */
  }
}

/**
 * @param {Record<string, unknown>} payload
 */
function logMessageInsert(payload) {
  try {
    console.log("MESSAGE_INSERT", payload);
  } catch (_) {
    /* non-fatal */
  }
}

/**
 * Resolve canonical thread for a message insert.
 * @param {{
 *   patientId: string,
 *   clinicId?: string|null,
 *   threadIdHint?: string|null,
 *   source?: string,
 *   caller?: string,
 * }} params
 */
async function resolveThreadForMessageInsert(params) {
  const patientId = String(params.patientId || "").trim();
  const clinicHint = String(params.clinicId || "").trim();
  const threadHint = String(params.threadIdHint || "").trim();
  const source = String(params.source || "message_insert").trim();
  const caller = String(params.caller || "unknown").trim();

  if (threadHint && UUID_RE.test(threadHint)) {
    return {
      ok: true,
      threadId: threadHint,
      clinicId: UUID_RE.test(clinicHint) ? clinicHint : null,
      source: "thread_hint",
      caller,
    };
  }

  if (!UUID_RE.test(patientId)) {
    return { ok: false, threadId: null, clinicId: null, source: "invalid_patient", caller };
  }

  const canonical = await getCanonicalThread(
    patientId,
    UUID_RE.test(clinicHint) ? clinicHint : null,
    {
      ...CANONICAL_THREAD_READ_OPTS,
      source: `message_insert:${source}`,
    },
  );

  const threadId =
    canonical.threadId && UUID_RE.test(String(canonical.threadId).trim())
      ? String(canonical.threadId).trim()
      : null;
  const clinicId =
    canonical.clinicId && UUID_RE.test(String(canonical.clinicId).trim())
      ? String(canonical.clinicId).trim()
      : UUID_RE.test(clinicHint)
        ? clinicHint
        : null;

  return {
    ok: !!threadId,
    threadId,
    clinicId,
    source: canonical.reason || "canonical",
    caller,
  };
}

/**
 * Ensure patient-facing payload has patient_id, clinic_id, thread_id.
 * @param {Record<string, unknown>} payload
 * @param {{
 *   caller: string,
 *   insertFn: string,
 *   source?: string,
 *   threadIdHint?: string|null,
 *   clinicIdHint?: string|null,
 *   allowMissingThread?: boolean,
 *   systemOnly?: boolean,
 * }} meta
 */
async function guardPatientFacingMessagePayload(payload, meta) {
  const row = { ...(payload || {}) };
  const caller = String(meta?.caller || "unknown").trim();
  const insertFn = String(meta?.insertFn || "unknown").trim();
  const source = String(meta?.source || "message_insert").trim();
  const systemOnly = meta?.systemOnly === true;
  const allowMissingThread = meta?.allowMissingThread === true || systemOnly;

  const patientId = String(row.patient_id || row.patientId || "").trim();
  let clinicId = String(row.clinic_id || row.clinicId || meta?.clinicIdHint || "").trim();
  let threadId = String(row.thread_id || row.threadId || meta?.threadIdHint || "").trim();

  const resolved = await resolveThreadForMessageInsert({
    patientId,
    clinicId: clinicId || null,
    threadIdHint: UUID_RE.test(threadId) ? threadId : null,
    source,
    caller,
  });

  if (!UUID_RE.test(patientId)) {
    return {
      ok: false,
      error: { message: "patient_id_required", code: "422" },
      payload: row,
      caller,
      insertFn,
      resolvedThreadId: null,
      persistedThreadId: null,
    };
  }

  if (!UUID_RE.test(clinicId) && resolved.clinicId) clinicId = resolved.clinicId;
  if (!UUID_RE.test(threadId) && resolved.threadId) threadId = resolved.threadId;

  if (!UUID_RE.test(clinicId)) {
    logMessageThreadMissing({
      caller,
      insert_fn: insertFn,
      patient_id: patientId,
      clinic_id: null,
      thread_id: UUID_RE.test(threadId) ? threadId : null,
      reason: "clinic_id_unresolved",
    });
    return {
      ok: false,
      error: { message: "clinic_id_required", code: "422" },
      payload: row,
      caller,
      insertFn,
      resolvedThreadId: resolved.threadId || null,
      persistedThreadId: null,
    };
  }

  if (!UUID_RE.test(threadId)) {
    logMessageThreadMissing({
      caller,
      insert_fn: insertFn,
      patient_id: patientId,
      clinic_id: clinicId,
      thread_id: null,
      reason: "thread_id_unresolved",
      canonical_source: resolved.source || null,
    });
    if (!allowMissingThread) {
      return {
        ok: false,
        error: { message: "thread_id_required", code: "422" },
        payload: row,
        caller,
        insertFn,
        resolvedThreadId: null,
        persistedThreadId: null,
      };
    }
  }

  row.patient_id = patientId;
  row.clinic_id = clinicId;
  if (UUID_RE.test(threadId)) row.thread_id = threadId;
  delete row.patientId;
  delete row.clinicId;
  delete row.threadId;

  return {
    ok: true,
    payload: row,
    caller,
    insertFn,
    resolvedThreadId: resolved.threadId || (UUID_RE.test(threadId) ? threadId : null),
    persistedThreadId: UUID_RE.test(threadId) ? threadId : null,
    clinicId,
  };
}

/**
 * @param {{
 *   patientId: string,
 *   clinicId?: string|null,
 *   threadId?: string|null,
 *   messageId?: string|null,
 *   caller: string,
 *   insertFn: string,
 *   via: string,
 *   resolvedThreadId?: string|null,
 *   persistedThreadId?: string|null,
 *   systemOnly?: boolean,
 * }} audit
 */
function auditMessageInsert(audit) {
  const patientId = String(audit.patientId || "").trim();
  const clinicId = String(audit.clinicId || "").trim();
  const persisted = String(audit.persistedThreadId || audit.threadId || "").trim();
  const resolved = String(audit.resolvedThreadId || "").trim();

  logMessageInsert({
    patient_id: patientId || null,
    clinic_id: clinicId || null,
    thread_id: persisted || null,
    resolved_thread_id: resolved || null,
    message_id: audit.messageId || null,
    via: audit.via || null,
    insert_fn: audit.insertFn || null,
    caller: audit.caller || null,
    system_only: audit.systemOnly === true,
  });
}

module.exports = {
  UUID_RE,
  resolveThreadForMessageInsert,
  guardPatientFacingMessagePayload,
  auditMessageInsert,
  logMessageThreadMissing,
};
