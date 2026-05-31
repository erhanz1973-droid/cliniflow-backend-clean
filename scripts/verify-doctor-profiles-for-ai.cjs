#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  mapDoctorProfileRow,
  assessDoctorProfileCompleteness,
  buildDoctorProfilesPromptBlock,
  procedureNamesFromIds,
} = require("../lib/doctorProfilesForAi");

const serap = mapDoctorProfileRow(
  {
    id: "doc-1",
    full_name: "Serap Zorlu",
    title: "Dr.",
    experience_years: 15,
    university: "Hacettepe University",
    graduation_year: 2008,
    specialties: null,
    languages: null,
    profile_procedure_ids: null,
  },
  "CEM Dental",
  { specialities: [], languages: [], procedures: [] },
);

assert.strictEqual(serap.completeness.specialtyMissing, true);
assert.strictEqual(serap.completeness.languagesMissing, true);
assert.strictEqual(serap.completeness.proceduresMissing, true);

const prompt = buildDoctorProfilesPromptBlock([serap], "CEM Dental");
assert.ok(prompt.includes("Do NOT invent"));
assert.ok(prompt.includes("never as an implant specialist"));
assert.ok(prompt.includes("Serap Zorlu"));
assert.ok(prompt.includes("15 years of experience"));
assert.ok(prompt.includes("Hacettepe University"));
assert.ok(!/- Dr\. Serap Zorlu.*implant specialist/i.test(prompt));
assert.ok(prompt.includes("missing specialty"));

const withSpecialty = mapDoctorProfileRow(
  {
    id: "doc-2",
    full_name: "Ali Veli",
    experience_years: 10,
    specialties: "İmplantoloji",
    languages: "Türkçe, English",
    profile_procedure_ids: ["IMPLANT"],
  },
  "Test Clinic",
  { specialities: [], languages: [], procedures: procedureNamesFromIds(["IMPLANT"]) },
);
assert.strictEqual(withSpecialty.completeness.specialtyMissing, false);
assert.strictEqual(withSpecialty.completeness.languagesMissing, false);
assert.strictEqual(withSpecialty.completeness.proceduresMissing, false);

const prompt2 = buildDoctorProfilesPromptBlock([withSpecialty], "Test Clinic");
assert.ok(prompt2.includes("İmplantoloji") || prompt2.includes("specialties"));

console.log("doctorProfilesForAi: ok");
