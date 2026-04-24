/**
 * Clinic tenancy helpers: normalized roles, admin context, query logging.
 * Set CLINIC_TENANCY_STRICT=0 to relax some checks (not recommended in production).
 */

const CLINIC_TENANCY_STRICT = String(process.env.CLINIC_TENANCY_STRICT || "1").trim() !== "0";

const CANONICAL_ROLES = new Set(["super_admin", "clinic_admin", "doctor"]);

/**
 * Map JWT / legacy string roles to canonical profile roles.
 */
function normalizeJwtRole(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === "admin" || s === "ADMIN") return "clinic_admin";
  if (low === "superadmin" || low === "super_admin" || low === "super-admin" || s === "SUPER_ADMIN") {
    return "super_admin";
  }
  if (low === "doctor" || s === "DOCTOR") return "doctor";
  if (CANONICAL_ROLES.has(low)) return low;
  return null;
}

/**
 * After req.clinicId is set, attach req.admin / req.user and verify clinic + role.
 * @returns {null | { status: number, body: object }}
 */
function attachAdminTenantContext(req, decoded, { pathLabel } = {}) {
  const clinicId = req.clinicId;
  if (!clinicId) {
    return {
      status: 403,
      body: {
        ok: false,
        error: "clinic_context_required",
        message: "Clinic context is required for this operation.",
      },
    };
  }

  const jwtClinic = decoded && decoded.clinicId;
  if (jwtClinic && String(jwtClinic) !== String(clinicId)) {
    console.warn("[CLINIC_TENANCY] JWT clinicId does not match resolved clinic", {
      jwtClinic,
      resolved: clinicId,
      path: pathLabel || req.path,
    });
    return {
      status: 403,
      body: { ok: false, error: "clinic_token_mismatch", message: "Token does not match resolved clinic." },
    };
  }

  const tokenType = decoded && decoded.type != null ? String(decoded.type).trim().toLowerCase() : "";
  if (tokenType && tokenType !== "admin") {
    return {
      status: 403,
      body: {
        ok: false,
        error: "admin_session_required",
        message: "Admin session required",
      },
    };
  }

  const rawRole = decoded && decoded.role;
  if (rawRole == null || String(rawRole).trim() === "") {
    return {
      status: 403,
      body: {
        ok: false,
        error: "user_role_not_configured",
        message: "User role not configured",
      },
    };
  }

  const role = normalizeJwtRole(rawRole);
  if (!role) {
    return {
      status: 403,
      body: {
        ok: false,
        error: "invalid_user_role",
        message: "User role is not valid for this system.",
      },
    };
  }

  if (!tokenType) {
    if (role !== "clinic_admin" && role !== "super_admin") {
      return {
        status: 403,
        body: {
          ok: false,
          error: "admin_session_required",
          message: "Admin session required",
        },
      };
    }
  } else {
    if (role !== "clinic_admin" && role !== "super_admin") {
      return {
        status: 403,
        body: {
          ok: false,
          error: "forbidden",
          message: "Clinic admin role required for this surface.",
        },
      };
    }
  }

  req.admin = {
    clinicId,
    role,
    rawRole: String(rawRole),
    email: decoded.email || null,
    adminId: decoded.adminId != null ? decoded.adminId : null,
    userId: decoded.userId != null ? decoded.userId : decoded.sub != null ? decoded.sub : null,
  };
  // Alias for handlers expecting req.user (doctor app may use the same later)
  req.user = { ...req.admin, clinicId };

  if (String(process.env.ADMIN_TENANCY_LOG || "").trim() === "1" || !CLINIC_TENANCY_STRICT) {
    logAdminQuery(req, pathLabel || "admin_auth", { stage: "attach" });
  }
  return null;
}

function logAdminQuery(req, endpoint, extra = {}) {
  const a = req.admin;
  const role = a && a.role ? a.role : req.admin?.rawRole;
  const clinicId = a && a.clinicId != null ? a.clinicId : req.clinicId;
  const ep = endpoint || (req && req.path) || "?";
  console.log(
    `[ADMIN_QUERY] clinicId=${clinicId} role=${role || "?"} endpoint=${ep}` +
      (Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "")
  );
}

module.exports = {
  CLINIC_TENANCY_STRICT,
  CANONICAL_ROLES,
  normalizeJwtRole,
  attachAdminTenantContext,
  logAdminQuery,
};
