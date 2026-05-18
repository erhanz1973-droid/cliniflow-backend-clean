#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import {
  detectMessageLanguage,
  resolveConversationLanguage,
} from "../lib/conversationLanguage.js";

test("Georgian script → ka high confidence", () => {
  const d = detectMessageLanguage("გამარჯობა, იმპლანტის ფასი რამდენია?");
  assert.equal(d.code, "ka");
  assert.ok(d.confidence >= 0.9);
  assert.equal(d.georgianScript, true);
});

test("Turkish conversation keeps Turkish when Georgian translit is ambiguous", () => {
  const state = resolveConversationLanguage({
    message: "gamarjoba rogor khar",
    conversationPrimaryLanguage: "tr",
    enabledLanguageCodes: ["tr", "en", "ka"],
    messageCount: 5,
  });
  assert.equal(state.conversationLanguage, "tr");
  assert.equal(state.languageSwitched, false);
});

test("High-confidence Georgian script switches from Turkish", () => {
  const state = resolveConversationLanguage({
    message: "გამარჯობა, რამდენი ღირს იმპლანტი?",
    conversationPrimaryLanguage: "tr",
    enabledLanguageCodes: ["tr", "ka", "en"],
    messageCount: 4,
  });
  assert.equal(state.conversationLanguage, "ka");
  assert.equal(state.languageSwitched, true);
});

test("Bootstrap first message in Turkish", () => {
  const state = resolveConversationLanguage({
    message: "Merhaba implant fiyatları nedir?",
    conversationPrimaryLanguage: null,
    patientAppLanguage: "en",
    clinicPrimaryLanguage: "en",
    enabledLanguageCodes: ["en", "tr"],
    messageCount: 0,
  });
  assert.equal(state.conversationLanguage, "tr");
});
