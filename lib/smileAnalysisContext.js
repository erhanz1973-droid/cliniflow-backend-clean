/**
 * Prompt block for POST /ai/chat when patient asks about their Smile Score results.
 * @param {object|null|undefined} ctx
 * @returns {string}
 */
function buildSmileAnalysisPromptBlock(ctx) {
  if (!ctx || typeof ctx !== "object") return "";
  const score = ctx.smileScore ?? ctx.smile_score;
  if (score == null || !Number.isFinite(Number(score))) return "";

  const lines = [
    "PATIENT SMILE ANALYSIS CONTEXT (aesthetic evaluation only — NOT a medical diagnosis):",
    `Overall Smile Score: ${Number(score)}/10`,
  ];
  const dental = ctx.dentalSmileScore ?? ctx.dental_smile_score;
  const facial = ctx.facialHarmonyScore ?? ctx.facial_harmony_score;
  if (dental != null && Number.isFinite(Number(dental))) {
    lines.push(`Dental Smile Score: ${Number(dental)}/10`);
  }
  if (facial != null && Number.isFinite(Number(facial))) {
    lines.push(`Facial Harmony Score: ${Number(facial)}/10`);
  }
  const potential = ctx.potentialScore ?? ctx.potential_score;
  if (potential != null && Number.isFinite(Number(potential))) {
    lines.push(`Estimated potential score after improvements: ${Number(potential)}/10`);
  }
  const strengths = Array.isArray(ctx.strengths) ? ctx.strengths : [];
  const improvements = Array.isArray(ctx.improvementAreas)
    ? ctx.improvementAreas
    : Array.isArray(ctx.improvement_areas)
      ? ctx.improvement_areas
      : [];
  const recommendations = Array.isArray(ctx.recommendations) ? ctx.recommendations : [];
  if (strengths.length) lines.push(`Strengths: ${strengths.map(String).join("; ")}`);
  if (improvements.length) {
    lines.push(`Improvement opportunities: ${improvements.map(String).join("; ")}`);
  }
  if (recommendations.length) {
    lines.push(`Recommended options: ${recommendations.map(String).join("; ")}`);
  }
  const cats = ctx.categoryScores || ctx.category_scores;
  if (cats && typeof cats === "object") {
    const parts = [];
    if (cats.whiteness != null) parts.push(`Whiteness ${Number(cats.whiteness)}/10`);
    if (cats.alignment != null) parts.push(`Alignment ${Number(cats.alignment)}/10`);
    if (cats.symmetry != null) parts.push(`Symmetry ${Number(cats.symmetry)}/10`);
    if (parts.length) lines.push(`Category scores: ${parts.join("; ")}`);
  }
  lines.push(
    "Answer ONLY about this smile aesthetic analysis. Explain scores in friendly language.",
    "Do NOT diagnose diseases. Suggest consulting a dentist for clinical decisions.",
  );
  return lines.join("\n");
}

module.exports = { buildSmileAnalysisPromptBlock };
