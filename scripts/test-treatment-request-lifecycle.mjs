#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolvePatientVisibleStatus,
  shouldMarkResponded,
} from "../lib/treatmentRequestLifecycle.js";

test("pending + clinic thread reply → answered responded", () => {
  const v = resolvePatientVisibleStatus(
    { status: "pending", proposal_status: "waiting_for_quote" },
    { coordinationHasClinicReply: true, formalOfferCount: 0 },
  );
  assert.equal(v.status, "answered");
  assert.equal(v.lifecycle, "responded");
});

test("formal offers → quoted tier", () => {
  const v = resolvePatientVisibleStatus(
    { status: "pending", lead_status: "inquiry" },
    { formalOfferCount: 1 },
  );
  assert.equal(v.status, "answered");
  assert.equal(v.lifecycle, "quoted");
});

test("shouldMarkResponded skips quoted lead", () => {
  assert.equal(
    shouldMarkResponded({ status: "pending", lead_status: "quoted" }),
    false,
  );
});
