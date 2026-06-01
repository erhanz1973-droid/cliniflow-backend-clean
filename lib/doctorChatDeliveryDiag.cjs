/**
 * Structured doctor chat delivery diagnostics (Railway logs).
 * Disable with DOCTOR_CHAT_DELIVERY_DIAG=0
 */

function diagEnabled() {
  return String(process.env.DOCTOR_CHAT_DELIVERY_DIAG || "1").trim() !== "0";
}

function shortId(v) {
  const s = String(v || "").trim();
  return s ? s.slice(0, 8) : null;
}

function logJson(tag, payload) {
  if (!diagEnabled()) return;
  try {
    console.log(tag, JSON.stringify({ at: new Date().toISOString(), ...payload }));
  } catch (e) {
    console.warn(`${tag} log_failed`, e?.message || e);
  }
}

/** @param {Record<string, unknown>} payload */
function logDoctorSocketJoin(payload) {
  logJson("[DOCTOR_SOCKET_JOIN]", {
    doctor_id: shortId(payload.doctor_id ?? payload.doctorId),
    patient_id: shortId(payload.patient_id ?? payload.patientId),
    thread_id: shortId(payload.thread_id ?? payload.threadId),
    requested_thread_id: shortId(payload.requested_thread_id ?? payload.requestedThreadId),
    room_id: payload.room_id ?? payload.roomId ?? null,
    room_size: payload.room_size ?? payload.roomSize ?? null,
    join_success: payload.join_success ?? payload.joinSuccess ?? true,
    reason: payload.reason ?? null,
  });
}

/** @param {Record<string, unknown>} payload */
function logDoctorSocketLeave(payload) {
  logJson("[DOCTOR_SOCKET_LEAVE]", {
    doctor_id: shortId(payload.doctor_id ?? payload.doctorId),
    patient_id: shortId(payload.patient_id ?? payload.patientId),
    thread_id: shortId(payload.thread_id ?? payload.threadId),
    room_id: payload.room_id ?? payload.roomId ?? null,
    reason: payload.reason ?? null,
    socket_id: payload.socket_id ?? payload.socketId ?? null,
  });
}

/** @param {Record<string, unknown>} payload */
function logThreadConsistencyCheck(payload) {
  logJson("[THREAD_CONSISTENCY_CHECK]", {
    patient_id: shortId(payload.patient_id ?? payload.patientId),
    doctor_id: shortId(payload.doctor_id ?? payload.doctorId),
    thread_id: shortId(payload.thread_id ?? payload.threadId),
    room_id: payload.room_id ?? payload.roomId ?? null,
    source: payload.source ?? null,
    message_id: payload.message_id ?? payload.messageId ?? null,
    fetch_thread_id: shortId(payload.fetch_thread_id ?? payload.fetchThreadId),
    emit_thread_id: shortId(payload.emit_thread_id ?? payload.emitThreadId),
    push_thread_id: shortId(payload.push_thread_id ?? payload.pushThreadId),
    mismatch: payload.mismatch ?? null,
  });
}

/** @param {Record<string, unknown>} payload */
function logPushCandidate(payload) {
  logJson("[PUSH_CANDIDATE]", {
    patient_id: shortId(payload.patient_id ?? payload.patientId),
    doctor_id: shortId(payload.doctor_id ?? payload.doctorId),
    thread_id: shortId(payload.thread_id ?? payload.threadId),
    clinic_id: shortId(payload.clinic_id ?? payload.clinicId),
    message_id: payload.message_id ?? payload.messageId ?? null,
    sender_role: payload.sender_role ?? payload.senderRole ?? null,
    routing_path: payload.routing_path ?? payload.routingPath ?? null,
  });
}

/** @param {Record<string, unknown>} payload */
function logPushSent(payload) {
  logJson("[PUSH_SENT]", {
    patient_id: shortId(payload.patient_id ?? payload.patientId),
    doctor_id: shortId(payload.doctor_id ?? payload.doctorId),
    thread_id: shortId(payload.thread_id ?? payload.threadId),
    message_id: payload.message_id ?? payload.messageId ?? null,
    badge: payload.badge ?? null,
    token_count: payload.token_count ?? payload.tokenCount ?? null,
  });
}

/** @param {Record<string, unknown>} payload */
function logPushSkipped(payload) {
  logJson("[PUSH_SKIPPED]", {
    patient_id: shortId(payload.patient_id ?? payload.patientId),
    doctor_id: shortId(payload.doctor_id ?? payload.doctorId),
    thread_id: shortId(payload.thread_id ?? payload.threadId),
    message_id: payload.message_id ?? payload.messageId ?? null,
    reason: payload.reason ?? "unknown",
  });
}

/** @param {Record<string, unknown>} payload */
function logUnreadBump(payload) {
  logJson("[DOCTOR_UNREAD_BUMP]", {
    patient_id: shortId(payload.patient_id ?? payload.patientId),
    doctor_id: shortId(payload.doctor_id ?? payload.doctorId),
    thread_id: shortId(payload.thread_id ?? payload.threadId),
    source: payload.source ?? null,
  });
}

module.exports = {
  logDoctorSocketJoin,
  logDoctorSocketLeave,
  logThreadConsistencyCheck,
  logPushCandidate,
  logPushSent,
  logPushSkipped,
  logUnreadBump,
};
