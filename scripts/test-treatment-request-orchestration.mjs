#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { summarizeForChat } from "../lib/treatmentRequestOrchestration.js";

test("summarizeForChat strips photo and analysis blocks", () => {
  const raw = `I need implants\n\n--- Photo ---\nhttps://x.com/a.jpg\n\n--- AI analysis (summary) ---\n{"foo":1}`;
  const out = summarizeForChat(raw);
  assert.equal(out, "I need implants");
});

test("summarizeForChat default when empty", () => {
  assert.equal(summarizeForChat(""), "Treatment quote request");
});
