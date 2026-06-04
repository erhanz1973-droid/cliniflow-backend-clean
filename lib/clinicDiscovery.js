/**
 * Public clinic marketplace discovery — list, filters, profile.
 */

const { computeMarketplaceCompleteness } = require("./clinicMarketplaceProfile");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INACTIVE_STATUSES = new Set([
  "suspended",
  "reject",
  "rejected",
  "inactive",
  "closed",
]);

const DISCOVERY_SELECT_ATTEMPTS = [
  `id, name, clinic_code, city, country, status, is_listed, logo_url, address, phone, email,
   short_description, about_text, website, website_url, facebook_url, instagram_url, tiktok_url, linkedin_url, youtube_url,
   whatsapp, google_maps_url, google_rating, google_review_count, trustpilot_rating, trustpilot_review_count,
   trustpilot_url, google_reviews_url, is_verified, is_featured, featured_until, listing_tier,
   years_in_operation, cover_photo_url,
   international_patient_count, languages, specialties, services, technologies, certifications, awards,
   working_hours, media_gallery, latitude, longitude`,
  `id, name, clinic_code, city, country, status, is_listed, logo_url, address, phone, email,
   short_description, website, website_url, google_maps_url, google_rating, google_review_count,
   is_verified, languages, specialties, latitude, longitude`,
  "id, name, clinic_code, city, country, status, is_listed, logo_url, address, phone, email, website, google_maps_url",
];

function isMissingColumnError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "");
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /column|schema|does not exist/i.test(msg)
  );
}

function parseNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseStringArray(val) {
  if (Array.isArray(val)) {
    return val.map((x) => String(x || "").trim()).filter(Boolean);
  }
  if (typeof val === "string" && val.trim()) {
    try {
      const j = JSON.parse(val);
      if (Array.isArray(j)) return parseStringArray(j);
    } catch (_) {
      /* comma-separated */
    }
    return val
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function parseMediaGallery(raw) {
  if (!raw || typeof raw !== "object") {
    return { photos: [], beforeAfter: [], videos: [] };
  }
  const photos = Array.isArray(raw.photos) ? raw.photos : [];
  const beforeAfter = Array.isArray(raw.beforeAfter)
    ? raw.beforeAfter
    : Array.isArray(raw.before_after)
      ? raw.before_after
      : [];
  const videos = Array.isArray(raw.videos) ? raw.videos : [];
  return { photos, beforeAfter, videos };
}

/** 0–7 social/research links filled — used for compare matrix and ranking tie-break. */
function computeSocialPresenceScore(clinic) {
  const urls = [
    clinic.websiteUrl,
    clinic.facebookUrl,
    clinic.instagramUrl,
    clinic.tiktokUrl,
    clinic.youtubeUrl,
    clinic.linkedinUrl,
    clinic.googleMapsUrl,
  ];
  return urls.filter((u) => String(u || "").trim()).length;
}

/** Simple ranking score for "best clinics" lists (not sponsored). */
function computeDiscoveryRankScore(clinic) {
  const rating = clinic.googleRating ?? clinic.trustpilotRating ?? 0;
  const reviews = clinic.googleReviewCount ?? clinic.trustpilotReviewCount ?? 0;
  const reviewBoost = reviews > 0 ? Math.log10(reviews + 1) : 0;
  let score = rating * (1 + reviewBoost * 0.25);
  if (clinic.isVerified) score += 0.15;
  if (clinic.isFeatured) score += 0.35;
  score += computeSocialPresenceScore(clinic) * 0.03;
  if (clinic.internationalPatientCount != null && clinic.internationalPatientCount >= 100) {
    score += 0.1;
  }
  return Math.round(score * 1000) / 1000;
}

function clinicFeaturedActive(row) {
  if (row?.is_featured !== true && row?.is_featured !== "true") return false;
  const until = row?.featured_until;
  if (!until) return true;
  const ts = Date.parse(String(until));
  return Number.isFinite(ts) && ts > Date.now();
}

function normalizeDiscoveryClinic(row, opts = {}) {
  const includeProfile = opts.profile === true;
  const id = String(row?.id || "").trim();
  const languages = parseStringArray(row?.languages);
  const specialties = parseStringArray(row?.specialties);
  const services = parseStringArray(row?.services);
  const technologies = parseStringArray(row?.technologies);
  const certifications = parseStringArray(row?.certifications);
  const awards = parseStringArray(row?.awards);

  const isFeatured = clinicFeaturedActive(row);
  const listingTier = String(row?.listing_tier || "standard").trim().toLowerCase() || "standard";

  const base = {
    id,
    name: String(row?.name || "").trim() || "Clinic",
    clinicCode: row?.clinic_code != null ? String(row.clinic_code).trim() || null : null,
    city: row?.city != null ? String(row.city).trim() || null : null,
    country: row?.country != null ? String(row.country).trim().toUpperCase() || null : null,
    logoUrl: row?.logo_url != null ? String(row.logo_url).trim() || null : null,
    coverPhotoUrl:
      row?.cover_photo_url != null ? String(row.cover_photo_url).trim() || null : null,
    shortDescription:
      row?.short_description != null ? String(row.short_description).trim() || null : null,
    googleRating: parseNum(row?.google_rating),
    googleReviewCount:
      row?.google_review_count != null ? parseInt(String(row.google_review_count), 10) || null : null,
    trustpilotRating: parseNum(row?.trustpilot_rating),
    trustpilotReviewCount:
      row?.trustpilot_review_count != null
        ? parseInt(String(row.trustpilot_review_count), 10) || null
        : null,
    internationalPatientCount:
      row?.international_patient_count != null
        ? parseInt(String(row.international_patient_count), 10) || null
        : null,
    languages,
    specialties,
    certifications,
    awards,
    isVerified: row?.is_verified === true || row?.is_verified === "true",
    isFeatured,
    listingTier,
    googleMapsUrl:
      row?.google_maps_url != null ? String(row.google_maps_url).trim() || null : null,
    latitude: parseNum(row?.latitude ?? row?.lat),
    longitude: parseNum(row?.longitude ?? row?.lng),
  };

  base.socialPresenceScore = computeSocialPresenceScore({
    ...base,
    websiteUrl: String(row?.website_url || row?.website || "").trim() || null,
    facebookUrl: row?.facebook_url,
    instagramUrl: row?.instagram_url,
    tiktokUrl: row?.tiktok_url,
    youtubeUrl: row?.youtube_url,
    linkedinUrl: row?.linkedin_url,
  });
  base.discoveryRankScore = computeDiscoveryRankScore(base);

  if (!includeProfile) return base;

  return {
    ...base,
    aboutText: row?.about_text != null ? String(row.about_text).trim() || null : null,
    address: row?.address != null ? String(row.address).trim() || null : null,
    phone: row?.phone != null ? String(row.phone).trim() || null : null,
    email: row?.email != null ? String(row.email).trim() || null : null,
    websiteUrl:
      String(row?.website_url || row?.website || "").trim() || null,
    facebookUrl: row?.facebook_url != null ? String(row.facebook_url).trim() || null : null,
    instagramUrl: row?.instagram_url != null ? String(row.instagram_url).trim() || null : null,
    tiktokUrl: row?.tiktok_url != null ? String(row.tiktok_url).trim() || null : null,
    youtubeUrl: row?.youtube_url != null ? String(row.youtube_url).trim() || null : null,
    linkedinUrl: row?.linkedin_url != null ? String(row.linkedin_url).trim() || null : null,
    whatsapp: row?.whatsapp != null ? String(row.whatsapp).trim() || null : null,
    googleReviewsUrl:
      row?.google_reviews_url != null ? String(row.google_reviews_url).trim() || null : null,
    trustpilotUrl: row?.trustpilot_url != null ? String(row.trustpilot_url).trim() || null : null,
    yearsInOperation:
      row?.years_in_operation != null
        ? parseInt(String(row.years_in_operation), 10) || null
        : null,
    services,
    technologies,
    workingHours:
      row?.working_hours && typeof row.working_hours === "object" ? row.working_hours : {},
    mediaGallery: parseMediaGallery(row?.media_gallery),
  };
}

function clinicIsActive(row) {
  const s = String(row?.status ?? "active").toLowerCase();
  return !INACTIVE_STATUSES.has(s);
}

function cityMatchesSimple(query, cityStr) {
  const q = String(query || "").trim().toLowerCase();
  if (!q || q.length < 2) return true;
  const c = String(cityStr || "").trim().toLowerCase();
  if (!c) return false;
  return c.includes(q) || q.includes(c);
}

function arrayIncludesInsensitive(haystack, needle) {
  const n = String(needle || "").trim().toLowerCase();
  if (!n) return true;
  return (haystack || []).some((h) => String(h || "").trim().toLowerCase() === n);
}

function applyDiscoveryFilters(clinics, query) {
  let rows = clinics.slice();

  const country = String(query.country || "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(country)) {
    rows = rows.filter((c) => String(c.country || "").toUpperCase() === country);
  }

  const city = String(query.city || "").trim();
  if (city.length >= 2) {
    rows = rows.filter((c) => cityMatchesSimple(city, c.city));
  }

  const minRating = parseNum(query.min_google_rating ?? query.minGoogleRating);
  if (minRating != null) {
    rows = rows.filter((c) => c.googleRating != null && c.googleRating >= minRating);
  }

  const minReviews = parseInt(
    String(query.min_google_reviews ?? query.minGoogleReviews ?? ""),
    10,
  );
  if (Number.isFinite(minReviews) && minReviews > 0) {
    rows = rows.filter(
      (c) => c.googleReviewCount != null && c.googleReviewCount >= minReviews,
    );
  }

  if (
    query.verified_only === "1" ||
    query.verified_only === "true" ||
    query.verifiedOnly === "true"
  ) {
    rows = rows.filter((c) => c.isVerified);
  }

  const specialty = String(query.specialty || "").trim();
  if (specialty) {
    rows = rows.filter((c) => arrayIncludesInsensitive(c.specialties, specialty));
  }

  const language = String(query.language || "").trim();
  if (language) {
    rows = rows.filter((c) => arrayIncludesInsensitive(c.languages, language));
  }

  const q = String(query.q || query.search || "").trim().toLowerCase();
  if (q.length >= 2) {
    rows = rows.filter((c) => {
      const blob = [
        c.name,
        c.city,
        c.country,
        c.shortDescription,
        ...(c.specialties || []),
        ...(c.languages || []),
        c.clinicCode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }

  return rows;
}

function sortDiscoveryList(clinics) {
  return clinics.slice().sort((a, b) => {
    const af = a.isFeatured ? 1 : 0;
    const bf = b.isFeatured ? 1 : 0;
    if (bf !== af) return bf - af;
    const ar = a.discoveryRankScore ?? 0;
    const br = b.discoveryRankScore ?? 0;
    if (br !== ar) return br - ar;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function buildCompareHighlights(clinics) {
  const highlights = [];
  if (!clinics.length) return highlights;

  const bestGoogle = clinics.reduce((best, c) => {
    if (c.googleRating == null) return best;
    if (!best || (c.googleRating ?? 0) > (best.googleRating ?? 0)) return c;
    return best;
  }, null);
  if (bestGoogle) {
    highlights.push({ key: "best_google_rating", clinicId: bestGoogle.id, label: bestGoogle.name });
  }

  const mostReviews = clinics.reduce((best, c) => {
    const n = c.googleReviewCount ?? 0;
    if (!best || n > (best.googleReviewCount ?? 0)) return c;
    return n > 0 ? c : best;
  }, null);
  if (mostReviews?.googleReviewCount) {
    highlights.push({
      key: "most_google_reviews",
      clinicId: mostReviews.id,
      label: mostReviews.name,
    });
  }

  const mostIntl = clinics.reduce((best, c) => {
    const n = c.internationalPatientCount ?? 0;
    if (!best || n > (best.internationalPatientCount ?? 0)) return c;
    return n > 0 ? c : best;
  }, null);
  if (mostIntl?.internationalPatientCount) {
    highlights.push({
      key: "most_international_patients",
      clinicId: mostIntl.id,
      label: mostIntl.name,
    });
  }

  return highlights;
}

async function fetchListedClinicRows(supabase) {
  let lastErr = null;
  for (const sel of DISCOVERY_SELECT_ATTEMPTS) {
    const { data, error } = await supabase
      .from("clinics")
      .select(sel)
      .eq("is_listed", true)
      .order("name", { ascending: true })
      .limit(500);
    if (!error) {
      return { rows: (data || []).filter(clinicIsActive), schemaPending: false };
    }
    lastErr = error;
    if (isMissingColumnError(error)) continue;
    throw error;
  }
  if (lastErr && /is_listed/i.test(String(lastErr.message || ""))) {
    return { rows: [], schemaPending: true, error: lastErr };
  }
  throw lastErr || new Error("discovery_fetch_failed");
}

async function fetchDiscoveryDoctors(supabase, clinicId) {
  const cid = String(clinicId || "").trim();
  if (!UUID_RE.test(cid)) return [];

  const selects = [
    "id, doctor_id, name, full_name, title, bio, specialties, photo_url, profile_photo_url, public_profile, status",
    "id, doctor_id, name, full_name, title, specialties, photo_url, status",
    "id, name, full_name, specialties, status",
  ];

  for (const sel of selects) {
    let q = supabase.from("doctors").select(sel).eq("clinic_id", cid).limit(80);
    const { data, error } = await q;
    if (error && isMissingColumnError(error)) continue;
    if (error) {
      const { data: d2, error: e2 } = await supabase
        .from("doctors")
        .select(sel)
        .eq("clinic_code", cid)
        .limit(80);
      if (e2) continue;
      return mapDiscoveryDoctors(d2);
    }
    return mapDiscoveryDoctors(data);
  }
  return [];
}

function mapDiscoveryDoctors(rows) {
  const out = [];
  for (const d of rows || []) {
    const st = String(d?.status || "ACTIVE").toUpperCase();
    if (["SUSPENDED", "REJECTED", "INACTIVE", "CLOSED"].includes(st)) continue;
    const pub = d?.public_profile;
    if (pub === false || pub === "false" || pub === 0) continue;
    const name = String(d?.full_name || d?.name || "").trim();
    if (!name) continue;
    out.push({
      id: String(d.id || d.doctor_id || "").trim(),
      name,
      title: d?.title != null ? String(d.title).trim() || null : null,
      bio: d?.bio != null ? String(d.bio).trim() || null : null,
      photoUrl:
        String(d?.photo_url || d?.profile_photo_url || "").trim() || null,
      specialties: parseStringArray(d?.specialties),
    });
  }
  return out;
}

function registerDiscoveryRoutes(app, { supabase }) {
  app.get("/api/discovery/countries", async (_req, res) => {
    try {
      const { rows, schemaPending } = await fetchListedClinicRows(supabase);
      if (schemaPending) {
        return res.status(503).json({
          ok: false,
          error: "discovery_schema_pending",
          message: "Apply clinic marketplace migration (is_listed + discovery columns).",
        });
      }
      const countries = [
        ...new Set(
          rows
            .map((r) => String(r.country || "").trim().toUpperCase())
            .filter((c) => /^[A-Z]{2}$/.test(c)),
        ),
      ].sort();
      return res.json({ ok: true, countries });
    } catch (e) {
      console.error("[GET /api/discovery/countries]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.get("/api/discovery/clinics", async (req, res) => {
    try {
      const country = String(req.query?.country || "").trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) {
        return res.status(400).json({
          ok: false,
          error: "country_required",
          message: "country must be ISO-2 code (e.g. TR)",
        });
      }

      const { rows: raw, schemaPending } = await fetchListedClinicRows(supabase);
      if (schemaPending) {
        return res.status(503).json({
          ok: false,
          error: "discovery_schema_pending",
          message: "Apply clinic marketplace migration.",
        });
      }

      let normalized = raw.map((r) => normalizeDiscoveryClinic(r, { profile: false }));
      normalized = applyDiscoveryFilters(normalized, { ...req.query, country });
      normalized = sortDiscoveryList(normalized).slice(0, 200);

      console.log("[discovery/clinics]", {
        country,
        filters: {
          city: req.query?.city,
          min_google_rating: req.query?.min_google_rating,
          min_google_reviews: req.query?.min_google_reviews,
          verified_only: req.query?.verified_only,
          specialty: req.query?.specialty,
          language: req.query?.language,
        },
        returned: normalized.length,
      });

      return res.json({ ok: true, clinics: normalized });
    } catch (e) {
      console.error("[GET /api/discovery/clinics]", e?.message || e);
      return res.status(500).json({
        ok: false,
        error: "discovery_clinics_failed",
        message: e?.message || "internal_error",
      });
    }
  });

  /** Side-by-side compare (max 5 clinics) — must register before :clinicId. */
  app.get("/api/discovery/clinics/compare", async (req, res) => {
    try {
      const rawIds = String(req.query?.ids || req.query?.clinicIds || "")
        .split(/[,|]/)
        .map((s) => s.trim())
        .filter((id) => UUID_RE.test(id));
      const ids = [...new Set(rawIds)].slice(0, 5);
      if (ids.length < 2) {
        return res.status(400).json({
          ok: false,
          error: "compare_requires_two_clinics",
          message: "Provide 2–5 clinic UUIDs via ids=id1,id2",
        });
      }

      const { rows: all, schemaPending } = await fetchListedClinicRows(supabase);
      if (schemaPending) {
        return res.status(503).json({ ok: false, error: "discovery_schema_pending" });
      }

      const byId = new Map(
        all.map((r) => [String(r.id), normalizeDiscoveryClinic(r, { profile: true })]),
      );
      const clinics = ids.map((id) => byId.get(id)).filter(Boolean);
      if (clinics.length < 2) {
        return res.status(404).json({ ok: false, error: "clinics_not_found" });
      }

      const criteria = clinics.map((c) => ({
        id: c.id,
        name: c.name,
        country: c.country,
        city: c.city,
        googleRating: c.googleRating,
        googleReviewCount: c.googleReviewCount,
        trustpilotRating: c.trustpilotRating,
        trustpilotReviewCount: c.trustpilotReviewCount,
        internationalPatientCount: c.internationalPatientCount,
        languages: c.languages,
        specialties: c.specialties,
        certifications: c.certifications,
        awards: c.awards,
        isVerified: c.isVerified,
        isFeatured: c.isFeatured,
        socialPresenceScore: c.socialPresenceScore,
        websiteUrl: c.websiteUrl,
        facebookUrl: c.facebookUrl,
        instagramUrl: c.instagramUrl,
        tiktokUrl: c.tiktokUrl,
        youtubeUrl: c.youtubeUrl,
        linkedinUrl: c.linkedinUrl,
        googleMapsUrl: c.googleMapsUrl,
        discoveryRankScore: c.discoveryRankScore,
      }));

      return res.json({
        ok: true,
        clinics: criteria,
        highlights: buildCompareHighlights(clinics),
      });
    } catch (e) {
      console.error("[GET /api/discovery/clinics/compare]", e?.message || e);
      return res.status(500).json({ ok: false, error: "compare_failed" });
    }
  });

  /** Ranked lists: best by country and/or treatment category. */
  app.get("/api/discovery/rankings", async (req, res) => {
    try {
      const country = String(req.query?.country || "").trim().toUpperCase();
      const category = String(req.query?.category || req.query?.specialty || "").trim();
      const limit = Math.min(
        50,
        Math.max(1, parseInt(String(req.query?.limit || "10"), 10) || 10),
      );

      const { rows: raw, schemaPending } = await fetchListedClinicRows(supabase);
      if (schemaPending) {
        return res.status(503).json({ ok: false, error: "discovery_schema_pending" });
      }

      let pool = raw.map((r) => normalizeDiscoveryClinic(r, { profile: false }));
      if (/^[A-Z]{2}$/.test(country)) {
        pool = pool.filter((c) => String(c.country || "").toUpperCase() === country);
      }
      if (category) {
        pool = pool.filter((c) => arrayIncludesInsensitive(c.specialties, category));
      }

      const ranked = sortDiscoveryList(pool).slice(0, limit);

      return res.json({
        ok: true,
        country: country || null,
        category: category || null,
        rankings: ranked.map((c, i) => ({
          rank: i + 1,
          clinicId: c.id,
          name: c.name,
          city: c.city,
          country: c.country,
          googleRating: c.googleRating,
          googleReviewCount: c.googleReviewCount,
          trustpilotRating: c.trustpilotRating,
          isVerified: c.isVerified,
          isFeatured: c.isFeatured,
          discoveryRankScore: c.discoveryRankScore,
          specialties: (c.specialties || []).slice(0, 5),
        })),
      });
    } catch (e) {
      console.error("[GET /api/discovery/rankings]", e?.message || e);
      return res.status(500).json({ ok: false, error: "rankings_failed" });
    }
  });

  app.get("/api/discovery/clinics/:clinicId", async (req, res) => {
    try {
      const clinicId = String(req.params?.clinicId || "").trim();
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "invalid_clinic_id" });
      }

      let row = null;
      let lastErr = null;
      for (const sel of DISCOVERY_SELECT_ATTEMPTS) {
        const { data, error } = await supabase
          .from("clinics")
          .select(sel)
          .eq("id", clinicId)
          .eq("is_listed", true)
          .maybeSingle();
        if (!error && data) {
          row = data;
          break;
        }
        lastErr = error;
        if (error && isMissingColumnError(error)) continue;
        if (error) throw error;
      }

      if (!row || !clinicIsActive(row)) {
        return res.status(404).json({ ok: false, error: "clinic_not_found" });
      }

      const clinic = normalizeDiscoveryClinic(row, { profile: true });
      const team = await fetchDiscoveryDoctors(supabase, clinicId);
      const profileCompleteness = computeMarketplaceCompleteness(row, {
        doctorCount: team.length,
      });

      return res.json({
        ok: true,
        clinic: { ...clinic, team, profileCompletenessPercent: profileCompleteness.percent },
      });
    } catch (e) {
      console.error("[GET /api/discovery/clinics/:id]", e?.message || e);
      return res.status(500).json({ ok: false, error: "discovery_profile_failed" });
    }
  });
}

module.exports = {
  registerDiscoveryRoutes,
  normalizeDiscoveryClinic,
  applyDiscoveryFilters,
  parseStringArray,
};
