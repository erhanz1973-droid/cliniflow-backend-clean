/**
 * Inbound AI reply orchestration — instant auto-reply vs delayed human-fallback.
 */

const { getClinicAiProfile } = require("./clinicAiSettings");
const { normalizeCoordinatorChannel } = require("./coordinatorChannels");

const OMNICHANNEL_CHANNELS = new Set(["messenger", "instagram", "whatsapp"]);

/** @readonly */
const REPLY_MODE = Object.freeze({
  INSTANT: "instant",
  WAIT_HUMAN: "wait_human",
  HUMAN_ONLY: "human_only",
});

/**
 * @param {unknown} policy
 */
function normalizeAiRepliesConfig(communicationPolicy) {
  const root =
    communicationPolicy && typeof communicationPolicy === "object" ? communicationPolicy : {};
  const ai =
    root.aiReplies && typeof root.aiReplies === "object"
      ? root.aiReplies
      : root.ai_replies && typeof root.ai_replies === "object"
        ? root.ai_replies
        : {};

  const envInstant = parseInt(process.env.AI_INBOUND_REPLY_DELAY_MS || "800", 10);
  const envOmniInstant = parseInt(process.env.AI_OMNICHANNEL_INSTANT_DELAY_MS || "200", 10);
  const envFirstInstant = parseInt(process.env.AI_FIRST_INBOUND_REPLY_DELAY_MS || "350", 10);
  const envFallbackMin = parseFloat(process.env.AI_DOCTOR_SILENCE_FALLBACK_MINUTES || "5");

  let replyMode = String(ai.replyMode || ai.mode || REPLY_MODE.INSTANT).trim().toLowerCase();
  if (!Object.values(REPLY_MODE).includes(replyMode)) {
    replyMode = REPLY_MODE.INSTANT;
  }
  if (ai.waitForHumanBeforeAi === true || ai.waitForHuman === true) {
    replyMode = REPLY_MODE.WAIT_HUMAN;
  }
  if (ai.humanOnlyMode === true || ai.humanOnly === true) {
    replyMode = REPLY_MODE.HUMAN_ONLY;
  }

  return {
    replyMode,
    instantEnabled: ai.instantEnabled !== false && replyMode !== REPLY_MODE.HUMAN_ONLY,
    humanFallbackEnabled:
      ai.humanFallbackEnabled !== false && replyMode !== REPLY_MODE.HUMAN_ONLY,
    instantDelayMs: Math.max(
      0,
      Number(ai.instantDelayMs) > 0
        ? Number(ai.instantDelayMs)
        : Number.isFinite(envInstant)
          ? envInstant
          : 800,
    ),
    omnichannelInstantDelayMs: Math.max(
      0,
      Number(ai.omnichannelInstantDelayMs) > 0
        ? Number(ai.omnichannelInstantDelayMs)
        : Number.isFinite(envOmniInstant)
          ? envOmniInstant
          : 200,
    ),
    firstContactInstantDelayMs: Math.max(
      0,
      Number(ai.firstContactInstantDelayMs) > 0
        ? Number(ai.firstContactInstantDelayMs)
        : Number.isFinite(envFirstInstant)
          ? envFirstInstant
          : 350,
    ),
    fallbackDelayMinutes: Math.max(
      1,
      Number(ai.fallbackDelayMinutes) > 0
        ? Number(ai.fallbackDelayMinutes)
        : Number.isFinite(envFallbackMin) && envFallbackMin > 0
          ? envFallbackMin
          : 5,
    ),
    officeHoursOnlyInstant: ai.officeHoursOnlyInstant === true,
  };
}

/**
 * @param {string} channel
 * @param {string} [source]
 */
function isOmnichannelInbound(channel, source) {
  const ch = normalizeCoordinatorChannel(channel || source, "in_app");
  return OMNICHANNEL_CHANNELS.has(ch);
}

/**
 * @param {{
 *   clinicId: string,
 *   channel?: string,
 *   source?: string,
 *   isFirstPatientTurn?: boolean,
 *   isQuoteRequest?: boolean,
 *   delegation?: { autoReplyAllowed?: boolean },
 * }} params
 */
async function resolveInboundAiOrchestration(params) {
  const clinicId = String(params.clinicId || "").trim();
  const profile = await getClinicAiProfile(clinicId);
  const cfg = normalizeAiRepliesConfig(profile.communicationPolicy);
  const omnichannel = isOmnichannelInbound(params.channel, params.source);
  const autoReplyAllowed = params.delegation?.autoReplyAllowed === true;

  let instantDelayMs = cfg.instantDelayMs;
  if (omnichannel) {
    instantDelayMs = cfg.omnichannelInstantDelayMs;
  } else if (params.isQuoteRequest) {
    instantDelayMs = Math.max(200, parseInt(process.env.AI_QUOTE_REQUEST_REPLY_DELAY_MS || "400", 10) || 400);
  } else if (params.isFirstPatientTurn) {
    instantDelayMs = cfg.firstContactInstantDelayMs;
  }

  const replyMode = cfg.replyMode;
  const runInstant =
    autoReplyAllowed && cfg.instantEnabled && replyMode === REPLY_MODE.INSTANT;

  const scheduleHumanFallback =
    cfg.humanFallbackEnabled &&
    process.env.AI_DOCTOR_SILENCE_FALLBACK_ENABLED !== "false" &&
    (replyMode === REPLY_MODE.WAIT_HUMAN ||
      (replyMode === REPLY_MODE.INSTANT &&
        omnichannel &&
        process.env.AI_OMNICHANNEL_SILENCE_FALLBACK_ENABLED === "true") ||
      (replyMode === REPLY_MODE.INSTANT &&
        !omnichannel &&
        process.env.AI_INBOUND_SILENCE_FALLBACK_ENABLED === "true"));

  /** When instant AI is active on Messenger/WhatsApp, skip the 2m doctor-silence timer by default. */
  const skipShortDoctorSilence =
    omnichannel && runInstant && replyMode === REPLY_MODE.INSTANT && !scheduleHumanFallback;

  return {
    ...cfg,
    omnichannel,
    autoReplyAllowed,
    runInstant,
    scheduleHumanFallback,
    skipShortDoctorSilence,
    instantDelayMs,
    fallbackDelayMs: Math.max(30_000, Math.round(cfg.fallbackDelayMinutes * 60 * 1000)),
    fallbackDelayMinutes: cfg.fallbackDelayMinutes,
  };
}

/**
 * @param {string} traceId
 * @param {Record<string, unknown>} fields
 */
function logAiReplyLatency(traceId, event, fields = {}) {
  console.log(
    `[ai.reply.latency] ${event}`,
    JSON.stringify({
      traceId,
      ts: new Date().toISOString(),
      ...fields,
    }),
  );
}

/**
 * @param {{ channel?: string, source?: string, patientId?: string, clinicId?: string }} meta
 */
function startAiReplyLatencyTrace(meta = {}) {
  const traceId = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const startedAt = Date.now();
  const marks = { webhook_received: startedAt };

  return {
    traceId,
    mark(stage) {
      const now = Date.now();
      marks[stage] = now;
      return now - startedAt;
    },
    finish(extra = {}) {
      const finishedAt = Date.now();
      const totalMs = finishedAt - startedAt;
      logAiReplyLatency(traceId, "complete", {
        channel: meta.channel || null,
        source: meta.source || null,
        patientId: meta.patientId ? String(meta.patientId).slice(0, 8) : null,
        clinicId: meta.clinicId ? String(meta.clinicId).slice(0, 8) : null,
        totalMs,
        stages: {
          webhook_to_ai_start_ms:
            marks.ai_generation_start != null ? marks.ai_generation_start - startedAt : null,
          ai_generation_ms:
            marks.ai_generation_end != null && marks.ai_generation_start != null
              ? marks.ai_generation_end - marks.ai_generation_start
              : null,
          outbound_ms:
            marks.outbound_complete != null && marks.ai_generation_end != null
              ? marks.outbound_complete - marks.ai_generation_end
              : null,
        },
        ...extra,
      });
      return { traceId, totalMs };
    },
  };
}

module.exports = {
  REPLY_MODE,
  OMNICHANNEL_CHANNELS,
  normalizeAiRepliesConfig,
  isOmnichannelInbound,
  resolveInboundAiOrchestration,
  startAiReplyLatencyTrace,
  logAiReplyLatency,
};
