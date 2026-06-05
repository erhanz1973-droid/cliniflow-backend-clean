/**
 * Clinic marketplace / public directory profile — admin self-service, completeness, listing rules.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SOCIAL_URL_FIELDS = [
  "facebook_url",
  "instagram_url",
  "tiktok_url",
  "youtube_url",
  "linkedin_url",
];

const MARKETPLACE_SELECT = `
  id, name, clinic_code, country, city, status, is_listed, logo_url, cover_photo_url,
  short_description, about_text,
  website, website_url, facebook_url, instagram_url, tiktok_url, youtube_url, linkedin_url, whatsapp,
  google_maps_url, google_reviews_url, google_rating, google_review_count,
  trustpilot_url, trustpilot_rating, trustpilot_review_count,
  years_in_operation, international_patient_count,
  languages, specialties, services, technologies, certifications, awards,
  media_gallery, working_hours,
  is_verified, is_featured, featured_until, listing_tier
`;

/** Profile completeness checklist (equal weight). */
const COMPLETENESS_ITEMS = [
  {
    id: "logo",
    label: "Logo",
    check: (r) => !!str(r.logo_url),
  },
  {
    id: "description",
    label: "Description",
    check: (r) => !!str(r.short_description),
  },
  {
    id: "website",
    label: "Website",
    check: (r) => !!websiteUrl(r),
  },
  {
    id: "googleRating",
    label: "Google Rating",
    check: (r) => parseNum(r.google_rating) != null && parseNum(r.google_rating) > 0,
  },
  {
    id: "languages",
    label: "Languages",
    check: (r) => arr(r.languages).length >= 1,
  },
  {
    id: "specialties",
    label: "Specialties",
    check: (r) => arr(r.specialties).length >= 1,
  },
  {
    id: "clinicPhotos",
    label: "Clinic Photos",
    check: (r) => gallery(r).photos.length >= 1,
  },
  {
    id: "video",
    label: "Video",
    check: (r) => gallery(r).videos.length >= 1 || !!str(r.youtube_url),
  },
  {
    id: "doctorProfiles",
    label: "Doctor Profiles",
    check: (_r, ctx) => (ctx?.doctorCount ?? 0) >= 1,
  },
  {
    id: "coverPhoto",
    label: "Cover Photo",
    check: (r) => !!str(r.cover_photo_url),
  },
  {
    id: "country",
    label: "Country",
    check: (r) => /^[A-Z]{2}$/.test(str(r.country).toUpperCase()),
  },
  {
    id: "city",
    label: "City",
    check: (r) => str(r.city).length >= 2,
  },
];

const LISTING_REQUIREMENTS = [
  { id: "logo", label: "Logo", check: (r) => !!str(r.logo_url) },
  { id: "description", label: "Description", check: (r) => !!str(r.short_description) },
  { id: "country", label: "Country", check: (r) => /^[A-Z]{2}$/.test(str(r.country).toUpperCase()) },
  {
    id: "specialty",
    label: "At least 1 specialty",
    check: (r) => arr(r.specialties).length >= 1,
  },
  {
    id: "language",
    label: "At least 1 language",
    check: (r) => arr(r.languages).length >= 1,
  },
  {
    id: "websiteOrSocial",
    label: "Website or social media link",
    check: (r) => !!websiteUrl(r) || hasSocialLink(r),
  },
];

function str(v) {
  return String(v ?? "").trim();
}

function parseNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function arr(val) {
  if (Array.isArray(val)) return val.map((x) => str(x)).filter(Boolean);
  if (typeof val === "string" && val.trim()) {
    try {
      const j = JSON.parse(val);
      if (Array.isArray(j)) return arr(j);
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

function gallery(row) {
  const raw = row?.media_gallery;
  if (!raw || typeof raw !== "object") {
    return { photos: [], beforeAfter: [], videos: [] };
  }
  return {
    photos: Array.isArray(raw.photos) ? raw.photos.map((u) => str(u)).filter(Boolean) : [],
    beforeAfter: Array.isArray(raw.beforeAfter)
      ? raw.beforeAfter.map((u) => str(u)).filter(Boolean)
      : Array.isArray(raw.before_after)
        ? raw.before_after.map((u) => str(u)).filter(Boolean)
        : [],
    videos: Array.isArray(raw.videos) ? raw.videos.map((u) => str(u)).filter(Boolean) : [],
  };
}

function websiteUrl(row) {
  return str(row?.website_url || row?.website) || null;
}

function hasSocialLink(row) {
  return SOCIAL_URL_FIELDS.some((f) => !!str(row?.[f]));
}

function computeMarketplaceCompleteness(row, ctx = {}) {
  const completed = [];
  const missing = [];
  for (const item of COMPLETENESS_ITEMS) {
    if (item.check(row, ctx)) {
      completed.push({ id: item.id, label: item.label });
    } else {
      missing.push({ id: item.id, label: item.label });
    }
  }
  const total = COMPLETENESS_ITEMS.length;
  const percent = total ? Math.round((completed.length / total) * 100) : 0;
  return { percent, completed, missing, total, completedCount: completed.length };
}

function validateListingRequirements(row) {
  const missing = [];
  for (const req of LISTING_REQUIREMENTS) {
    if (!req.check(row)) missing.push({ id: req.id, label: req.label });
  }
  return { ok: missing.length === 0, missing };
}

function meetsListingRequirements(row) {
  return validateListingRequirements(row).ok;
}

function mapRowToAdminProfile(row, ctx = {}) {
  const g = gallery(row);
  const completeness = computeMarketplaceCompleteness(row, ctx);
  const listing = validateListingRequirements(row);
  const listingTier = str(row?.listing_tier).toLowerCase() || "standard";

  return {
    clinicId: row.id,
    isListed: row.is_listed === true || row.is_listed === "true",
    reputation: {
      googleBusinessUrl: str(row.google_reviews_url) || null,
      googleRating: parseNum(row.google_rating),
      googleReviewCount:
        row.google_review_count != null ? parseInt(String(row.google_review_count), 10) || null : null,
      trustpilotUrl: str(row.trustpilot_url) || null,
      trustpilotRating: parseNum(row.trustpilot_rating),
      trustpilotReviewCount:
        row.trustpilot_review_count != null
          ? parseInt(String(row.trustpilot_review_count), 10) || null
          : null,
      yearsInOperation:
        row.years_in_operation != null ? parseInt(String(row.years_in_operation), 10) || null : null,
      internationalPatientsPerYear:
        row.international_patient_count != null
          ? parseInt(String(row.international_patient_count), 10) || null
          : null,
    },
    platformFlags: {
      isVerified: row.is_verified === true || row.is_verified === "true",
      isFeatured: row.is_featured === true || row.is_featured === "true",
      listingTier,
      featuredUntil: row.featured_until || null,
      adminOnly: true,
    },
    social: {
      website: websiteUrl(row),
      facebook: str(row.facebook_url) || null,
      instagram: str(row.instagram_url) || null,
      tiktok: str(row.tiktok_url) || null,
      youtube: str(row.youtube_url) || null,
      linkedin: str(row.linkedin_url) || null,
      googleMapsUrl: str(row.google_maps_url) || null,
      whatsapp: str(row.whatsapp) || null,
    },
    clinicInfo: {
      shortDescription: str(row.short_description) || null,
      aboutText: str(row.about_text) || null,
      languages: arr(row.languages),
      specialties: arr(row.specialties),
      services: arr(row.services),
      technologies: arr(row.technologies),
      country: str(row.country).toUpperCase() || null,
      city: str(row.city) || null,
    },
    media: {
      logoUrl: str(row.logo_url) || null,
      coverPhotoUrl: str(row.cover_photo_url) || null,
      galleryPhotos: g.photos,
      beforeAfterImages: g.beforeAfter,
      videoUrls: g.videos,
    },
    completeness,
    listingRequirements: listing,
    doctorCount: ctx.doctorCount ?? 0,
  };
}

function clampRating(v, max = 5) {
  const n = parseNum(v);
  if (n == null) return null;
  return Math.max(0, Math.min(max, Math.round(n * 100) / 100));
}

function clampInt(v, min = 0, max = 9999999) {
  if (v == null || v === "") return null;
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function normalizeUrl(v) {
  const s = str(v);
  if (!s) return null;
  return s;
}

/**
 * Build DB patch from admin PUT body (self-managed fields only).
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown>} existing
 */
function buildMarketplaceProfilePatch(body, existing) {
  const rep = body.reputation && typeof body.reputation === "object" ? body.reputation : {};
  const social = body.social && typeof body.social === "object" ? body.social : {};
  const info = body.clinicInfo && typeof body.clinicInfo === "object" ? body.clinicInfo : {};
  const media = body.media && typeof body.media === "object" ? body.media : {};

  const patch = {};

  if (Object.keys(rep).length) {
    if ("googleBusinessUrl" in rep) patch.google_reviews_url = normalizeUrl(rep.googleBusinessUrl);
    if ("googleRating" in rep) patch.google_rating = clampRating(rep.googleRating);
    if ("googleReviewCount" in rep) patch.google_review_count = clampInt(rep.googleReviewCount);
    if ("trustpilotUrl" in rep) patch.trustpilot_url = normalizeUrl(rep.trustpilotUrl);
    if ("trustpilotRating" in rep) patch.trustpilot_rating = clampRating(rep.trustpilotRating);
    if ("trustpilotReviewCount" in rep) patch.trustpilot_review_count = clampInt(rep.trustpilotReviewCount);
    if ("yearsInOperation" in rep) patch.years_in_operation = clampInt(rep.yearsInOperation, 0, 200);
    if ("internationalPatientsPerYear" in rep) {
      patch.international_patient_count = clampInt(rep.internationalPatientsPerYear);
    }
  }

  if (Object.keys(social).length) {
    if ("website" in social) {
      const w = normalizeUrl(social.website);
      patch.website_url = w;
      patch.website = w;
    }
    if ("facebook" in social) patch.facebook_url = normalizeUrl(social.facebook);
    if ("instagram" in social) patch.instagram_url = normalizeUrl(social.instagram);
    if ("tiktok" in social) patch.tiktok_url = normalizeUrl(social.tiktok);
    if ("youtube" in social) patch.youtube_url = normalizeUrl(social.youtube);
    if ("linkedin" in social) patch.linkedin_url = normalizeUrl(social.linkedin);
    if ("googleMapsUrl" in social) patch.google_maps_url = normalizeUrl(social.googleMapsUrl);
    if ("whatsapp" in social) patch.whatsapp = normalizeUrl(social.whatsapp);
  }

  if (Object.keys(info).length) {
    if ("shortDescription" in info) patch.short_description = str(info.shortDescription) || null;
    if ("aboutText" in info) patch.about_text = str(info.aboutText) || null;
    if ("languages" in info) patch.languages = arr(info.languages);
    if ("specialties" in info) patch.specialties = arr(info.specialties);
    if ("services" in info) patch.services = arr(info.services);
    if ("technologies" in info) patch.technologies = arr(info.technologies);
    if ("country" in info && str(info.country)) patch.country = str(info.country).toUpperCase();
    if ("city" in info) patch.city = str(info.city) || null;
  }

  if (Object.keys(media).length) {
    if ("logoUrl" in media) patch.logo_url = normalizeUrl(media.logoUrl);
    if ("coverPhotoUrl" in media) patch.cover_photo_url = normalizeUrl(media.coverPhotoUrl);
    if ("galleryPhotos" in media || "beforeAfterImages" in media || "videoUrls" in media) {
      const prev = gallery(existing);
      patch.media_gallery = {
        photos: "galleryPhotos" in media ? arr(media.galleryPhotos) : prev.photos,
        beforeAfter: "beforeAfterImages" in media ? arr(media.beforeAfterImages) : prev.beforeAfter,
        videos: "videoUrls" in media ? arr(media.videoUrls) : prev.videos,
      };
    }
  }

  if (body.isListed != null) {
    const wasListed = existing?.is_listed === true || existing?.is_listed === "true";
    const wantsListed = body.isListed === true;
    // Only patch listing flag when it actually changes — avoids re-triggering publish
    // validation on every reputation/social save for already-listed clinics.
    if (wantsListed !== wasListed) {
      patch.is_listed = wantsListed;
    }
  }

  return patch;
}

async function countClinicDoctors(supabase, clinicId) {
  try {
    const { count, error } = await supabase
      .from("doctors")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId);
    if (error) return 0;
    return count ?? 0;
  } catch (_) {
    return 0;
  }
}

async function fetchClinicMarketplaceRow(supabase, clinicId) {
  const { data, error } = await supabase
    .from("clinics")
    .select(MARKETPLACE_SELECT)
    .eq("id", clinicId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * @param {import("express").Express} app
 * @param {{ supabase: object, requireAdminAuth: Function, superAdminGuard: Function }} deps
 */
function registerClinicMarketplaceAdminRoutes(app, deps) {
  const { supabase, requireAdminAuth, superAdminGuard } = deps;

  app.get("/api/admin/marketplace-profile", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinic?.id || req.clinicId || "").trim();
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "invalid_clinic" });
      }
      const row = await fetchClinicMarketplaceRow(supabase, clinicId);
      if (!row) return res.status(404).json({ ok: false, error: "clinic_not_found" });
      const doctorCount = await countClinicDoctors(supabase, clinicId);
      return res.json({
        ok: true,
        profile: mapRowToAdminProfile(row, { doctorCount }),
      });
    } catch (e) {
      console.error("[GET /api/admin/marketplace-profile]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.put("/api/admin/marketplace-profile", requireAdminAuth, async (req, res) => {
    try {
      const clinicId = String(req.clinic?.id || req.clinicId || "").trim();
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "invalid_clinic" });
      }
      const existing = await fetchClinicMarketplaceRow(supabase, clinicId);
      if (!existing) return res.status(404).json({ ok: false, error: "clinic_not_found" });

      const body = req.body && typeof req.body === "object" ? req.body : {};
      const patch = buildMarketplaceProfilePatch(body, existing);
      if (!Object.keys(patch).length) {
        return res.status(400).json({ ok: false, error: "empty_update" });
      }

      const merged = { ...existing, ...patch };
      const wasListed = existing.is_listed === true || existing.is_listed === "true";
      const wantsListed = body.isListed === true;
      // Only block when first publishing. Already-listed clinics may update reputation/social
      // even if legacy rows predate current listing requirements.
      if (wantsListed && !wasListed) {
        const listing = validateListingRequirements(merged);
        if (!listing.ok) {
          return res.status(400).json({
            ok: false,
            error: "listing_requirements_not_met",
            message: "Complete required fields before publishing to the directory.",
            listingRequirements: listing,
          });
        }
      }

      patch.updated_at = new Date().toISOString();
      const { data, error } = await supabase
        .from("clinics")
        .update(patch)
        .eq("id", clinicId)
        .select(MARKETPLACE_SELECT)
        .maybeSingle();
      if (error) {
        return res.status(500).json({ ok: false, error: "update_failed", message: error.message });
      }
      const doctorCount = await countClinicDoctors(supabase, clinicId);
      return res.json({
        ok: true,
        profile: mapRowToAdminProfile(data, { doctorCount }),
      });
    } catch (e) {
      console.error("[PUT /api/admin/marketplace-profile]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  /** Super-admin: verified / featured / sponsored placement */
  app.patch(
    "/api/super-admin/clinics/:clinicId/marketplace-trust",
    superAdminGuard,
    async (req, res) => {
      try {
        const clinicId = String(req.params.clinicId || "").trim();
        if (!UUID_RE.test(clinicId)) {
          return res.status(400).json({ ok: false, error: "invalid_id" });
        }
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const patch = { updated_at: new Date().toISOString() };

        if ("isVerified" in body || "is_verified" in body) {
          patch.is_verified = body.isVerified === true || body.is_verified === true;
        }
        if ("isFeatured" in body || "is_featured" in body) {
          patch.is_featured = body.isFeatured === true || body.is_featured === true;
        }
        if ("featuredUntil" in body || "featured_until" in body) {
          const raw = body.featuredUntil ?? body.featured_until;
          patch.featured_until = raw ? String(raw) : null;
        }
        if ("listingTier" in body || "listing_tier" in body) {
          const tier = str(body.listingTier ?? body.listing_tier).toLowerCase();
          if (!["standard", "featured", "sponsored"].includes(tier)) {
            return res.status(400).json({ ok: false, error: "invalid_listing_tier" });
          }
          patch.listing_tier = tier;
          if (tier === "featured" || tier === "sponsored") {
            patch.is_featured = true;
          }
        }

        if (Object.keys(patch).length <= 1) {
          return res.status(400).json({ ok: false, error: "empty_update" });
        }

        const { data, error } = await supabase
          .from("clinics")
          .update(patch)
          .eq("id", clinicId)
          .select(
            "id, is_verified, is_featured, featured_until, listing_tier, is_listed, name",
          )
          .maybeSingle();
        if (error) {
          return res.status(500).json({ ok: false, error: "update_failed", message: error.message });
        }
        if (!data) return res.status(404).json({ ok: false, error: "not_found" });
        return res.json({ ok: true, clinic: data });
      } catch (e) {
        console.error("[PATCH marketplace-trust]", e?.message || e);
        return res.status(500).json({ ok: false, error: "internal_error" });
      }
    },
  );
}

module.exports = {
  registerClinicMarketplaceAdminRoutes,
  computeMarketplaceCompleteness,
  validateListingRequirements,
  meetsListingRequirements,
  mapRowToAdminProfile,
  buildMarketplaceProfilePatch,
  MARKETPLACE_SELECT,
};
