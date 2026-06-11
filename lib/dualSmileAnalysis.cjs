"use strict";

/**
 * Two-photo smile analysis: smiling face + close-up teeth.
 * Used by POST /api/chat/ai-analyze when teethImageUrl is provided.
 */

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(Math.min(10, Math.max(0, x)) * 10) / 10;
}

function pickStringArray(v, max = 6) {
  if (!Array.isArray(v)) return [];
  return v.map((s) => String(s || "").trim()).filter(Boolean).slice(0, max);
}

function normalizeCategoryScoresFromParsed(raw) {
  const cs = raw?.categoryScores || raw?.category_scores || {};
  return {
    whiteness: clampScore(cs.whiteness ?? cs.brightness),
    alignment: clampScore(cs.alignment),
    symmetry: clampScore(cs.symmetry),
    aesthetics: clampScore(cs.aesthetics ?? cs.smileAesthetics),
  };
}

function deriveOverallSmileScore(rawOverall, dental, facial) {
  const overall = clampScore(rawOverall);
  const d = clampScore(dental);
  const f = clampScore(facial);
  if (overall != null) return overall;
  if (d != null && f != null) {
    return clampScore((d + f) / 2);
  }
  return d ?? f ?? null;
}

/** Strict normalization — no default scores when fields are missing. */
function normalizeDualSmileFromParsed(raw) {
  const dentalSmileScore = clampScore(raw?.dentalSmileScore ?? raw?.dental_smile_score);
  const facialHarmonyScore = clampScore(
    raw?.facialHarmonyScore ?? raw?.facial_harmony_score,
  );
  const smileScore = deriveOverallSmileScore(raw?.smileScore, dentalSmileScore, facialHarmonyScore);
  const potentialScore = clampScore(raw?.potentialScore);
  const categoryScores = normalizeCategoryScoresFromParsed(raw);

  const strengths = pickStringArray(raw?.strengths, 5);
  const improvementAreas = pickStringArray(raw?.improvementAreas, 5);
  const recommendations = pickStringArray(raw?.recommendations, 6);

  const insights = pickStringArray(raw?.insights, 3);
  if (!insights.length) {
    if (strengths[0]) insights.push(strengths[0]);
    if (improvementAreas[0]) insights.push(improvementAreas[0]);
    if (strengths[1]) insights.push(strengths[1]);
    else if (improvementAreas[1]) insights.push(improvementAreas[1]);
  }

  let summary = String(raw?.summary || "").trim();
  if (!summary && strengths.length) {
    summary = strengths.slice(0, 2).join(". ");
    if (summary && !summary.endsWith(".")) summary += ".";
  }
  let recommendation = String(raw?.recommendation || "").trim();
  if (!recommendation && recommendations[0]) recommendation = recommendations[0];
  if (!recommendation && improvementAreas[0]) recommendation = improvementAreas[0];

  const smilePhotoUsable = raw?.smilePhotoUsable !== false;
  const teethPhotoUsable = raw?.teethPhotoUsable !== false;

  return {
    smileScore,
    dentalSmileScore,
    facialHarmonyScore,
    potentialScore,
    categoryScores,
    strengths,
    improvementAreas,
    recommendations,
    insights: insights.slice(0, 3),
    summary,
    recommendation,
    smilePhotoUsable,
    teethPhotoUsable,
    confidence: raw?.confidence,
    missingTeethLikely: raw?.missingTeethLikely,
    dentalConditionParsed: raw?.dentalConditionParsed,
  };
}

function validateDualSmileAIQuality(parsed) {
  const reasons = [];

  if (parsed.smilePhotoUsable === false) {
    return {
      ok: false,
      score: 0,
      reasons: ["smile_photo_unusable"],
      retakeTarget: "smile",
    };
  }
  if (parsed.teethPhotoUsable === false) {
    return {
      ok: false,
      score: 0,
      reasons: ["teeth_photo_unusable"],
      retakeTarget: "teeth",
    };
  }

  if (!Number.isFinite(Number(parsed.smileScore))) {
    reasons.push("no_smile_score");
  }
  if (!Number.isFinite(Number(parsed.dentalSmileScore))) {
    reasons.push("missing_dental_smile_score");
  }
  if (!Number.isFinite(Number(parsed.facialHarmonyScore))) {
    reasons.push("missing_facial_harmony_score");
  }

  const strengths = Array.isArray(parsed.strengths) ? parsed.strengths : [];
  const improvementAreas = Array.isArray(parsed.improvementAreas) ? parsed.improvementAreas : [];
  if (strengths.length < 1) reasons.push("no_strengths");
  if (improvementAreas.length < 1) reasons.push("no_improvement_areas");

  if (!["low", "medium", "high"].includes(parsed.confidence)) {
    reasons.push("invalid_confidence");
  }

  let retakeTarget = "both";
  if (
    reasons.includes("missing_dental_smile_score") ||
    reasons.includes("teeth_photo_unusable")
  ) {
    retakeTarget = "teeth";
  } else if (
    reasons.includes("missing_facial_harmony_score") ||
    reasons.includes("no_smile_score") ||
    reasons.includes("smile_photo_unusable")
  ) {
    retakeTarget = "smile";
  }

  return {
    ok: reasons.length === 0,
    score: reasons.length === 0 ? 80 : 0,
    reasons,
    retakeTarget,
  };
}

function generateDualSmileAnalysisPrompt() {
  return {
    system: `You are a smile aesthetics assistant evaluating TWO patient photos together:
1) SMILE PHOTO — natural smiling face (facial harmony, smile expression, lip-smile balance)
2) TEETH PHOTO — close-up of teeth (tooth appearance, brightness, alignment, gum aesthetics)

IMPORTANT: Respond in English only. All human-readable strings must be in English.

This is AESTHETIC evaluation only — NOT medical diagnosis. Do NOT diagnose diseases or cavities.

SCORING MODEL (Smile Score v2):
- smileScore = Overall Smile Score (0.0–10.0, one decimal) — holistic impression blending dental + facial factors.
- dentalSmileScore = Dental Smile Score from TEETH photo + visible dental aesthetics in smile photo:
  tooth appearance, alignment, brightness, smile line, visible gum aesthetics, dental symmetry.
- facialHarmonyScore = Facial Harmony Score from SMILE photo:
  smile/lip harmony, smile width, smile visibility, facial-smile balance, positive smile expression.
- categoryScores (optional detail): whiteness, alignment, symmetry, aesthetics — sub-scores 0.0–10.0.
- potentialScore = realistic improvement potential after cosmetic options (usually 0.5–2.0 above smileScore).

COMMUNICATION STYLE — never diagnose or prescribe:
- BAD: "You need orthodontics." / "You require treatment."
- GOOD: "Orthodontic consultation may improve alignment." / "Teeth whitening may improve smile brightness."

RULES:
- Do NOT require clinical intraoral detail in the smile photo — dental detail belongs in the teeth photo.
- Do NOT penalize the smile photo for lacking close-up tooth detail.
- strengths: 2–3 genuine positives (include facial AND dental strengths when visible).
- improvementAreas: 2–3 gentle opportunities using "may improve" / "may enhance" language.
- recommendations: 2–4 cosmetic OPTIONS only (Professional Cleaning, Teeth Whitening, Orthodontic Consultation, Veneer Consultation).

If a photo is unusable (blurry, dark, teeth not visible, wrong angle):
- Set smilePhotoUsable or teethPhotoUsable to false for that photo.
- Do NOT invent scores for an unusable photo — set affected scores to null.
- Still return valid JSON.

Return ONLY valid JSON — no markdown.`,

    user: `You receive two images in order: (1) SMILE PHOTO, (2) TEETH CLOSE-UP.

Return ONLY this JSON:
{
  "smileScore": 7.8,
  "dentalSmileScore": 7.1,
  "facialHarmonyScore": 8.4,
  "potentialScore": 9.0,
  "categoryScores": {
    "whiteness": 6.5,
    "alignment": 7.2,
    "symmetry": 8.0,
    "aesthetics": 7.5
  },
  "smilePhotoUsable": true,
  "teethPhotoUsable": true,
  "strengths": ["Natural smile", "Good facial harmony", "Positive smile expression"],
  "improvementAreas": ["Tooth brightness may be improved", "Minor alignment improvements may enhance aesthetics"],
  "recommendations": ["Professional Cleaning", "Teeth Whitening", "Orthodontic Consultation", "Veneer Consultation"],
  "confidence": "low" | "medium" | "high",
  "summary": "1-sentence combined assessment",
  "recommendation": "1 primary suggested next step",
  "missingTeethLikely": "yes" | "no" | "unclear",
  "dentalCondition": "missing_tooth" | "misalignment" | "diastema" | "none" | "unclear",
  "dentalConditionConfidence": "low" | "medium" | "high"
}`,
  };
}

async function callOpenAIVisionDual(
  system,
  user,
  smileDataUrl,
  teethDataUrl,
  { apiKey, timeoutMs = 45000, parseMissingTeethVisionFlag, parseDentalConditionFields } = {},
) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: user },
            { type: "image_url", image_url: { url: smileDataUrl, detail: "high" } },
            { type: "image_url", image_url: { url: teethDataUrl, detail: "high" } },
          ],
        },
      ],
      max_tokens: 1400,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(errBody?.error?.message || "OpenAI request failed");
    err.code = "openai_error";
    err.status = res.status;
    err.detail = errBody?.error;
    throw err;
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "{}";

  let raw = {};
  try {
    raw = JSON.parse(content);
  } catch {
    /* fall through */
  }

  const normalized = normalizeDualSmileFromParsed(raw);
  const parsed = {
    ...normalized,
    confidence: raw.confidence,
    missingTeethLikely:
      typeof parseMissingTeethVisionFlag === "function"
        ? parseMissingTeethVisionFlag(raw)
        : raw.missingTeethLikely,
    dentalConditionParsed:
      typeof parseDentalConditionFields === "function"
        ? parseDentalConditionFields(raw)
        : null,
  };

  return { parsed, usage: data.usage, model: data.model || "gpt-4o" };
}

function hashDualSmileCacheKey(smileDataUrl, teethDataUrl) {
  const crypto = require("crypto");
  return crypto
    .createHash("sha256")
    .update(String(smileDataUrl || ""), "utf8")
    .update("\0", "utf8")
    .update(String(teethDataUrl || ""), "utf8")
    .update("\0dual_smile", "utf8")
    .digest("hex");
}

module.exports = {
  normalizeCategoryScoresFromParsed,
  normalizeDualSmileFromParsed,
  validateDualSmileAIQuality,
  generateDualSmileAnalysisPrompt,
  callOpenAIVisionDual,
  hashDualSmileCacheKey,
};
