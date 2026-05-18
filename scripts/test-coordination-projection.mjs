/**
 * Unit checks for operational status derivation (no Supabase required).
 * Run: node scripts/test-coordination-projection.mjs
 */
import {
  deriveOperationalStatus,
  OPERATIONAL_STATUS,
  normalizeMessagePreview,
  buildCoordinationProjection,
} from "../lib/coordinationProjection.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const baseLead = {
  coordinationMode: "ai_assisted",
  sla: { isWaiting1h: false, isWaiting4h: false },
};

assert(
  deriveOperationalStatus({ appointmentScheduled: true }, baseLead) ===
    OPERATIONAL_STATUS.APPOINTMENT_BOOKED,
  "booked",
);

assert(
  deriveOperationalStatus({ proposalStatus: "quote_sent" }, baseLead) === OPERATIONAL_STATUS.QUOTE_SENT,
  "quote_sent",
);

assert(
  deriveOperationalStatus({ missingXray: true }, baseLead) === OPERATIONAL_STATUS.WAITING_FOR_XRAY,
  "xray",
);

assert(
  deriveOperationalStatus({ proposalStatus: "coordinator_responded" }, baseLead) ===
    OPERATIONAL_STATUS.COORDINATOR_RESPONDED,
  "coordinator_responded",
);

const msg = normalizeMessagePreview("Hello from clinic", { role: "clinic" });
assert(msg?.text === "Hello from clinic" && msg.role === "clinic", "normalize string preview");

const proj = buildCoordinationProjection(
  {
    ...baseLead,
    operationalIntakeFlags: { latestMessagePreview: "Persisted text", latestMessageRole: "patient" },
    blockingReason: "Need X-ray",
    nextAction: "Request imaging",
  },
  {},
);
assert(proj.latestMessagePreview === "Persisted text", "persisted preview string");
assert(proj.blocker === "Need X-ray", "blocker");

console.log("coordination-projection: ok");
