#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  isSchedulingContinuationFragment,
  shouldMergeWithLastPatientMessage,
  messageHasSchedulingIntent,
  buildStaleSchedulingResetPatch,
  repairWhatsappNumberAskOnChannel,
  CONTINUATION_FRAGMENT_RE,
} = require("../lib/aiInboundRouter");
const { beginAiReplyGeneration, endAiReplyGeneration } = require("../lib/patientInboundDedup");

const pid = "00000000-0000-4000-8000-000000000001";
const cid = "00000000-0000-4000-8000-000000000002";

// Split WhatsApp burst: scheduling line + "istiyorum"
const schedulingLine = "Cuma öğleden sonra için bir randevu";
assert.strictEqual(messageHasSchedulingIntent(schedulingLine), true);
assert.strictEqual(
  isSchedulingContinuationFragment("İstiyorum", [{ role: "patient", text: schedulingLine }]),
  true,
);
assert.strictEqual(shouldMergeWithLastPatientMessage("İstiyorum", schedulingLine), true);

// Non-scheduling continuation should not merge
assert.strictEqual(
  isSchedulingContinuationFragment("Tamam", [{ role: "patient", text: "Merhaba" }]),
  false,
);

// Stale Monday state cleared when Friday requested
const staleFlags = {
  aiBooking: {
    stage: "slots_offered",
    bookingActive: true,
    preferredDateYmd: "2026-06-01",
    offeredSlots: [{ dateYmd: "2026-06-01", startAt: "2026-06-01T11:00:00+03:00" }],
    slotListId: "old-list",
    selectedSlot: null,
  },
  activeAppointment: {
    startAt: "2026-06-03T11:30:00+03:00",
    label: "Wed 11:30",
  },
};
const fridayMsg = "Cuma öğleden sonra için bir randevu istiyorum";
const reset = buildStaleSchedulingResetPatch(staleFlags, fridayMsg, "Europe/Istanbul");
assert.ok(reset, "expected stale scheduling reset");
assert.ok(Array.isArray(reset.aiBooking.offeredSlots) && reset.aiBooking.offeredSlots.length === 0);
assert.strictEqual(reset.aiBooking.slotListId, null);

// WhatsApp channel must not ask for WhatsApp number
const badReply =
  "Pazartesi için randevu talebinizi not aldım. WhatsApp numaranızı paylaşabilir misiniz?";
const fixed = repairWhatsappNumberAskOnChannel(badReply, "whatsapp", "+447726948765");
assert.ok(!/payla[sş]abilir misiniz/i.test(fixed) || /devam edelim/i.test(fixed));
assert.ok(!/whatsapp numaran[ıi]z[ıi].*payla[sş]/i.test(fixed));

// Parallel generation mutex — substantive second message defers, burst fragments suppress
const slot1 = beginAiReplyGeneration(pid, cid, "Cuma randevu istiyorum");
assert.strictEqual(slot1.allowed, true);
const slot2 = beginAiReplyGeneration(pid, cid, "Ama saat belirtmediniz");
assert.strictEqual(slot2.allowed, false);
assert.strictEqual(slot2.deferRetry, true);
const slot3 = beginAiReplyGeneration(pid, cid, "İstiyorum", {
  recentTurns: [{ role: "patient", text: schedulingLine }],
});
assert.strictEqual(slot3.allowed, false);
assert.strictEqual(slot3.deferRetry, false);
endAiReplyGeneration(pid, cid);
assert.strictEqual(beginAiReplyGeneration(pid, cid, "follow up").allowed, true);
endAiReplyGeneration(pid, cid);

assert.ok(CONTINUATION_FRAGMENT_RE.test("istiyorum"));

console.log("verify-ai-inbound-router: all checks passed");
