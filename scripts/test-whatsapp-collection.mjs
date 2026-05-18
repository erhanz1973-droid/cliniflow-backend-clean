/**
 * Unit checks for progressive WhatsApp collection logic.
 * Run: node scripts/test-whatsapp-collection.mjs
 */
import {
  evaluateWhatsappCollectionCandidate,
  extractWhatsappFromPatientMessage,
  normalizeWhatsappNumber,
  COLLECTION_STAGES,
} from "../lib/whatsappCollection.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const settings = {
  requestWhatsappEnabled: true,
  askWhatsappAfterStage: "responded",
};

const earlyProfile = {
  message_count: 1,
  communicationPolicy: { whatsappCollection: settings },
};

const r1 = evaluateWhatsappCollectionCandidate(earlyProfile, {}, {}, "How much are implants?");
assert(!r1.candidate, "no ask on first pricing message");

const activeProfile = {
  message_count: 6,
  last_ai_reply_at: new Date().toISOString(),
  communicationPolicy: { whatsappCollection: settings },
};

const r2 = evaluateWhatsappCollectionCandidate(
  activeProfile,
  { proposalStatus: "coordinator_responded", firstClinicResponseAt: "2026-01-01" },
  { bookingIntent: "medium" },
  "When can I book a consultation?",
);
assert(r2.candidate, "ask during appointment planning stage");

const extracted = extractWhatsappFromPatientMessage("My WhatsApp is +905551234567");
assert(extracted?.number && normalizeWhatsappNumber(extracted.number), "extract number");

const declined = extractWhatsappFromPatientMessage("I prefer email, no whatsapp");
assert(declined?.declined, "detect decline");

console.log("whatsapp-collection: ok");
