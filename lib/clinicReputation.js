/**
 * Multi-platform clinic reputation — Google, Facebook, Trustpilot.
 * Stored in dedicated columns + reputation_sources JSONB for future sources.
 */

const SOURCE_KEYS = ["google", "facebook", "trustpilot"];

function str(v) {
  return String(v ?? "").trim();
}

function parseNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseIntSafe(v) {
  if (v == null || v === "") return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function parseClinicSettings(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw);
      return j && typeof j === "object" && !Array.isArray(j) ? j : {};
    } catch (_) {
      return {};
    }
  }
  return {};
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
function buildReputationSourcesFromRow(row) {
  const settings = parseClinicSettings(row?.settings);
  const stored =
    row?.reputation_sources && typeof row.reputation_sources === "object"
      ? row.reputation_sources
      : settings.reputationSources && typeof settings.reputationSources === "object"
        ? settings.reputationSources
        : {};

  const google = {
    key: "google",
    label: "Google",
    url: str(row?.google_reviews_url) || str(stored.google?.url) || null,
    rating: parseNum(row?.google_rating ?? stored.google?.rating),
    reviewCount: parseIntSafe(row?.google_review_count ?? stored.google?.reviewCount),
    lastUpdatedAt: stored.google?.lastUpdatedAt || null,
    displayType: "stars",
    icon: "⭐",
  };

  const facebook = {
    key: "facebook",
    label: "Facebook",
    url:
      str(row?.facebook_page_url) ||
      str(stored.facebook?.url) ||
      str(row?.facebook_url) ||
      null,
    score: parseNum(row?.facebook_recommendation_score ?? stored.facebook?.score),
    rating: null,
    reviewCount: parseIntSafe(
      row?.facebook_recommendation_count ?? stored.facebook?.reviewCount,
    ),
    lastUpdatedAt: stored.facebook?.lastUpdatedAt || null,
    displayType: "percent",
    icon: "👍",
  };

  const trustpilot = {
    key: "trustpilot",
    label: "Trustpilot",
    url: str(row?.trustpilot_url) || str(stored.trustpilot?.url) || null,
    rating: parseNum(row?.trustpilot_rating ?? stored.trustpilot?.rating),
    reviewCount: parseIntSafe(row?.trustpilot_review_count ?? stored.trustpilot?.reviewCount),
    lastUpdatedAt: stored.trustpilot?.lastUpdatedAt || null,
    displayType: "stars",
    icon: "⭐",
  };

  return { google, facebook, trustpilot };
}

/**
 * @param {{ google: object, facebook: object, trustpilot: object }} sources
 */
function reputationSourceIsVisible(source) {
  if (!source) return false;
  if (source.displayType === "percent") {
    return source.score != null && source.score > 0;
  }
  return source.rating != null && source.rating > 0;
}

/**
 * @param {{ google: object, facebook: object, trustpilot: object }} sources
 */
function listVisibleReputationSources(sources) {
  return SOURCE_KEYS.map((k) => sources[k]).filter(reputationSourceIsVisible);
}

/**
 * Format lines like:
 * ⭐ Google 4.8 (420 reviews)
 * 👍 Facebook 96% (145 recommendations)
 */
function formatReputationDisplayLine(source) {
  if (!reputationSourceIsVisible(source)) return null;
  const count = source.reviewCount != null ? source.reviewCount : 0;
  if (source.displayType === "percent") {
    const pct = Math.round(Number(source.score) * 10) / 10;
    return `${source.icon} ${source.label} ${pct}% (${count} recommendations)`;
  }
  const rating = Math.round(Number(source.rating) * 10) / 10;
  const unit = source.key === "trustpilot" ? "reviews" : "reviews";
  return `${source.icon} ${source.label} ${rating} (${count} ${unit})`;
}

/**
 * @param {{ google: object, facebook: object, trustpilot: object }} sources
 */
function buildReputationDisplayLines(sources) {
  return listVisibleReputationSources(sources)
    .map(formatReputationDisplayLine)
    .filter(Boolean);
}

/**
 * Admin API reputation block (flat + structured).
 * @param {Record<string, unknown>|null|undefined} row
 */
function mapReputationForAdmin(row) {
  const sources = buildReputationSourcesFromRow(row);
  return {
    googleBusinessUrl: sources.google.url,
    googleRating: sources.google.rating,
    googleReviewCount: sources.google.reviewCount,
    googleLastUpdatedAt: sources.google.lastUpdatedAt,
    facebookPageUrl: sources.facebook.url,
    facebookRecommendationScore: sources.facebook.score,
    facebookRecommendationCount: sources.facebook.reviewCount,
    facebookLastUpdatedAt: sources.facebook.lastUpdatedAt,
    trustpilotUrl: sources.trustpilot.url,
    trustpilotRating: sources.trustpilot.rating,
    trustpilotReviewCount: sources.trustpilot.reviewCount,
    trustpilotLastUpdatedAt: sources.trustpilot.lastUpdatedAt,
    sources,
    displayLines: buildReputationDisplayLines(sources),
  };
}

/**
 * Discovery / compare API shape.
 * @param {Record<string, unknown>|null|undefined} row
 */
function mapReputationForDiscovery(row) {
  const sources = buildReputationSourcesFromRow(row);
  const visible = listVisibleReputationSources(sources).map((s) => ({
    key: s.key,
    label: s.label,
    url: s.url,
    rating: s.rating,
    score: s.score,
    reviewCount: s.reviewCount,
    lastUpdatedAt: s.lastUpdatedAt,
    displayType: s.displayType,
    icon: s.icon,
    displayLine: formatReputationDisplayLine(s),
  }));
  return {
    googleRating: sources.google.rating,
    googleReviewCount: sources.google.reviewCount,
    googleReviewsUrl: sources.google.url,
    facebookPageUrl: sources.facebook.url,
    facebookRecommendationScore: sources.facebook.score,
    facebookRecommendationCount: sources.facebook.reviewCount,
    trustpilotRating: sources.trustpilot.rating,
    trustpilotReviewCount: sources.trustpilot.reviewCount,
    trustpilotUrl: sources.trustpilot.url,
    reputationSources: visible,
    reputationDisplayLines: buildReputationDisplayLines(sources),
    primaryReputationScore: pickPrimaryReputationScore(sources),
  };
}

function pickPrimaryReputationScore(sources) {
  if (sources.google.rating != null) return sources.google.rating;
  if (sources.trustpilot.rating != null) return sources.trustpilot.rating;
  if (sources.facebook.score != null) return Number(sources.facebook.score) / 20;
  return null;
}

function clampRating(v, max = 5) {
  const n = parseNum(v);
  if (n == null) return null;
  return Math.max(0, Math.min(max, Math.round(n * 100) / 100));
}

function clampPercent(v) {
  const n = parseNum(v);
  if (n == null) return null;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

function clampInt(v, min = 0, max = 9999999) {
  const n = parseIntSafe(v);
  if (n == null) return null;
  return Math.max(min, Math.min(max, n));
}

function normalizeUrl(v) {
  const s = str(v);
  return s || null;
}

/**
 * Apply reputation fields from admin PUT to DB patch.
 * @param {Record<string, unknown>} patch
 * @param {Record<string, unknown>} rep
 * @param {Record<string, unknown>} existing
 */
function applyReputationPatch(patch, rep, existing) {
  if (!rep || typeof rep !== "object") return patch;
  const nowIso = new Date().toISOString();
  const prevSources = buildReputationSourcesFromRow(existing);
  const nextSources = { ...prevSources };

  if ("googleBusinessUrl" in rep) patch.google_reviews_url = normalizeUrl(rep.googleBusinessUrl);
  if ("googleRating" in rep) patch.google_rating = clampRating(rep.googleRating);
  if ("googleReviewCount" in rep) patch.google_review_count = clampInt(rep.googleReviewCount);
  if (
    "googleBusinessUrl" in rep ||
    "googleRating" in rep ||
    "googleReviewCount" in rep
  ) {
    nextSources.google = {
      ...nextSources.google,
      url: "googleBusinessUrl" in rep ? normalizeUrl(rep.googleBusinessUrl) : nextSources.google.url,
      rating:
        "googleRating" in rep ? clampRating(rep.googleRating) : nextSources.google.rating,
      reviewCount:
        "googleReviewCount" in rep
          ? clampInt(rep.googleReviewCount)
          : nextSources.google.reviewCount,
      lastUpdatedAt: nowIso,
    };
  }

  if ("facebookPageUrl" in rep) {
    const fbPage = normalizeUrl(rep.facebookPageUrl);
    patch.facebook_page_url = fbPage;
    // One Facebook field is enough — mirror to social link for discovery / listing rules.
    if (fbPage && !str(existing?.facebook_url) && patch.facebook_url == null) {
      patch.facebook_url = fbPage;
    }
  }
  if ("facebookRecommendationScore" in rep) {
    patch.facebook_recommendation_score = clampPercent(rep.facebookRecommendationScore);
  }
  if ("facebookRecommendationCount" in rep) {
    patch.facebook_recommendation_count = clampInt(rep.facebookRecommendationCount);
  }
  if (
    "facebookPageUrl" in rep ||
    "facebookRecommendationScore" in rep ||
    "facebookRecommendationCount" in rep
  ) {
    nextSources.facebook = {
      ...nextSources.facebook,
      url: "facebookPageUrl" in rep ? normalizeUrl(rep.facebookPageUrl) : nextSources.facebook.url,
      score:
        "facebookRecommendationScore" in rep
          ? clampPercent(rep.facebookRecommendationScore)
          : nextSources.facebook.score,
      reviewCount:
        "facebookRecommendationCount" in rep
          ? clampInt(rep.facebookRecommendationCount)
          : nextSources.facebook.reviewCount,
      lastUpdatedAt: nowIso,
    };
  }

  if ("trustpilotUrl" in rep) patch.trustpilot_url = normalizeUrl(rep.trustpilotUrl);
  if ("trustpilotRating" in rep) patch.trustpilot_rating = clampRating(rep.trustpilotRating);
  if ("trustpilotReviewCount" in rep) {
    patch.trustpilot_review_count = clampInt(rep.trustpilotReviewCount);
  }
  if ("trustpilotUrl" in rep || "trustpilotRating" in rep || "trustpilotReviewCount" in rep) {
    nextSources.trustpilot = {
      ...nextSources.trustpilot,
      url: "trustpilotUrl" in rep ? normalizeUrl(rep.trustpilotUrl) : nextSources.trustpilot.url,
      rating:
        "trustpilotRating" in rep ? clampRating(rep.trustpilotRating) : nextSources.trustpilot.rating,
      reviewCount:
        "trustpilotReviewCount" in rep
          ? clampInt(rep.trustpilotReviewCount)
          : nextSources.trustpilot.reviewCount,
      lastUpdatedAt: nowIso,
    };
  }

  if ("yearsInOperation" in rep) patch.years_in_operation = clampInt(rep.yearsInOperation, 0, 200);
  if ("internationalPatientsPerYear" in rep) {
    patch.international_patient_count = clampInt(rep.internationalPatientsPerYear);
  }

  const touchedReputation =
    "googleBusinessUrl" in rep ||
    "googleRating" in rep ||
    "googleReviewCount" in rep ||
    "facebookPageUrl" in rep ||
    "facebookRecommendationScore" in rep ||
    "facebookRecommendationCount" in rep ||
    "trustpilotUrl" in rep ||
    "trustpilotRating" in rep ||
    "trustpilotReviewCount" in rep;

  if (touchedReputation) {
    patch.reputation_sources = {
      google: {
        url: nextSources.google.url,
        rating: nextSources.google.rating,
        reviewCount: nextSources.google.reviewCount,
        lastUpdatedAt: nextSources.google.lastUpdatedAt,
      },
      facebook: {
        url: nextSources.facebook.url,
        score: nextSources.facebook.score,
        reviewCount: nextSources.facebook.reviewCount,
        lastUpdatedAt: nextSources.facebook.lastUpdatedAt,
      },
      trustpilot: {
        url: nextSources.trustpilot.url,
        rating: nextSources.trustpilot.rating,
        reviewCount: nextSources.trustpilot.reviewCount,
        lastUpdatedAt: nextSources.trustpilot.lastUpdatedAt,
      },
    };
  }

  return patch;
}

module.exports = {
  SOURCE_KEYS,
  buildReputationSourcesFromRow,
  listVisibleReputationSources,
  buildReputationDisplayLines,
  formatReputationDisplayLine,
  mapReputationForAdmin,
  mapReputationForDiscovery,
  applyReputationPatch,
  reputationSourceIsVisible,
};
