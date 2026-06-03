/**
 * Push coordinator / WhatsApp legs into the doctor patient-chat Socket.IO room.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @type {import("socket.io").Server | null} */
let chatSocketIo = null;

/**
 * @param {{ chatSocketIo?: import("socket.io").Server | null }} deps
 */
function setupDoctorChatRealtimeEmit(deps) {
  chatSocketIo = deps?.chatSocketIo || null;
}

function normalizeCreatedAtMs(raw) {
  if (raw == null) return Date.now();
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 0 && raw < 1e11) return Math.floor(raw * 1000);
    return raw;
  }
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * @param {{
 *   patientId?: string,
 *   clinicId?: string|null,
 *   threadId?: string|null,
 *   text?: string,
 *   from?: "PATIENT" | "CLINIC",
 *   id?: string,
 *   createdAt?: number|string|null,
 *   inboundKind?: string,
 *   senderName?: string,
 *   legacy?: Record<string, unknown>,
 *   source?: string,
 * }} opts
 */
async function emitDoctorChatLegacyMessage(opts) {
  if (!chatSocketIo) return { emitted: false, reason: "socket_not_ready" };

  const patientId = String(opts.patientId || "").trim();
  const clinicId = String(opts.clinicId || "").trim();
  let threadId = String(opts.threadId || "").trim();
  if (!UUID_RE.test(threadId) && UUID_RE.test(patientId)) {
    try {
      const { getCanonicalThread, CANONICAL_THREAD_READ_OPTS } = require("./canonicalChatThread");
      const canonical = await getCanonicalThread(
        patientId,
        UUID_RE.test(clinicId) ? clinicId : null,
        {
          ...CANONICAL_THREAD_READ_OPTS,
          source: String(opts.source || "doctor_chat_emit").trim(),
        },
      );
      if (canonical.threadId && UUID_RE.test(String(canonical.threadId).trim())) {
        threadId = String(canonical.threadId).trim();
      }
    } catch (_) {
      /* optional */
    }
  }
  if (!UUID_RE.test(threadId)) {
    return { emitted: false, reason: "thread_id_unresolved" };
  }

  const fromRaw = String(opts.from || opts.legacy?.from || "CLINIC").toUpperCase();
  const leg =
    opts.legacy && typeof opts.legacy === "object"
      ? { ...opts.legacy }
      : {
          id: String(opts.id || `coord_emit_${Date.now()}`),
          text: String(opts.text || ""),
          from: fromRaw === "PATIENT" ? "PATIENT" : "CLINIC",
          createdAt: normalizeCreatedAtMs(opts.createdAt),
          thread_id: threadId,
        };

  if (!String(leg.id || "").trim()) {
    leg.id = `coord_emit_${Date.now()}`;
  }
  if (!String(leg.text || "").trim() && opts.text) {
    leg.text = String(opts.text);
  }
  if (!leg.createdAt) leg.createdAt = normalizeCreatedAtMs(opts.createdAt);
  if (!leg.thread_id) leg.thread_id = threadId;
  if (opts.inboundKind && !leg.inboundKind) leg.inboundKind = opts.inboundKind;
  if (opts.senderName && !leg.senderName) leg.senderName = opts.senderName;
  if (fromRaw === "CLINIC" && !leg.inboundKind && leg.senderName === "AI") {
    leg.inboundKind = "clinic";
  }

  const roomId = `chat:${threadId}`;
  chatSocketIo.to(roomId).emit("new_message", leg);
  return { emitted: true, roomId, threadId, messageId: String(leg.id || "") };
}

module.exports = {
  setupDoctorChatRealtimeEmit,
  emitDoctorChatLegacyMessage,
};
