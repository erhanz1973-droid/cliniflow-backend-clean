/**
 * Super Admin "Login as Clinic" — impersonation sessions, tokens, audit logging.
 * Support mode only (full edit); architecture ready for view_only later.
 */

const crypto = require("crypto");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const IMPERSONATION_MODES = new Set(["support", "view_only"]);
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const DEFAULT_IMPERSONATION_TTL = String(
  process.env.IMPERSONATION_TOKEN_TTL || "4h",
).trim();

function resolveImpersonationRedirectUrl() {
  const raw = str(
    process.env.CLINIC_ADMIN_UI_URL || process.env.ADMIN_UI_URL || "",
  );
  if (raw) {
    const base = raw.replace(/\/+$/, "");
    return base.endsWith("/admin.html") ? base : `${base}/admin.html`;
  }
  return "/admin.html";
}

function str(v) {
  return String(v ?? "").trim();
}

function isMissingSchemaError(err) {
  const msg = str(err?.message || err).toLowerCase();
  const code = str(err?.code);
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /does not exist|schema cache|could not find the table/i.test(msg)
  );
}

function resolveSuperAdminActor(superAdmin) {
  const email = str(superAdmin?.email).toLowerCase();
  const userId = superAdmin?.userId || superAdmin?.id || null;
  const displayName =
    str(superAdmin?.name) ||
    (email.includes("@") ? email.split("@")[0].replace(/[._]/g, " ") : email) ||
    "Super Admin";
  return { email, userId, displayName };
}

function formatAuditSummary({ actorDisplayName, action, clinicName, timestamp }) {
  return `Admin: ${actorDisplayName}\nAction: ${action}\nClinic: ${clinicName || "—"}\nTimestamp: ${timestamp}`;
}

async function insertAuditLog(supabase, row) {
  if (!supabase) {
    console.log("[super_admin.audit]", JSON.stringify(row));
    return;
  }
  try {
    const { error } = await supabase.from("super_admin_audit_log").insert([row]);
    if (error) {
      if (isMissingSchemaError(error)) {
        console.warn("[super_admin.audit] table missing — console only:", row.action);
        console.log("[super_admin.audit]", JSON.stringify(row));
        return;
      }
      console.error("[super_admin.audit] insert failed:", error.message);
    }
  } catch (e) {
    console.error("[super_admin.audit]", e?.message || e);
  }
}

async function createImpersonationSession(supabase, {
  clinicId,
  actorEmail,
  actorUserId,
  mode,
  metadata,
}) {
  const sessionId = crypto.randomUUID();
  if (!supabase) {
    return { sessionId, dbPersisted: false };
  }
  try {
    const { data, error } = await supabase
      .from("super_admin_impersonation_sessions")
      .insert([
        {
          id: sessionId,
          impersonated_clinic_id: clinicId,
          impersonated_by_user_id: actorUserId || null,
          impersonated_by_email: actorEmail,
          mode,
          metadata: metadata || {},
        },
      ])
      .select("id, started_at")
      .single();
    if (error) {
      if (isMissingSchemaError(error)) {
        console.warn("[impersonation] sessions table missing — JWT-only session");
        return { sessionId, dbPersisted: false, startedAt: new Date().toISOString() };
      }
      throw error;
    }
    return {
      sessionId: data.id,
      dbPersisted: true,
      startedAt: data.started_at,
    };
  } catch (e) {
    console.error("[impersonation] create session:", e?.message || e);
    return { sessionId, dbPersisted: false, startedAt: new Date().toISOString() };
  }
}

async function endImpersonationSession(supabase, sessionId) {
  if (!supabase || !UUID_RE.test(sessionId)) return false;
  try {
    const endedAt = new Date().toISOString();
    const { error } = await supabase
      .from("super_admin_impersonation_sessions")
      .update({ ended_at: endedAt })
      .eq("id", sessionId)
      .is("ended_at", null);
    if (error && !isMissingSchemaError(error)) {
      console.error("[impersonation] end session:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[impersonation] end session:", e?.message || e);
    return false;
  }
}

function buildImpersonationAdminToken(jwt, JWT_SECRET, payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: DEFAULT_IMPERSONATION_TTL });
}

/**
 * Attach impersonation context on authenticated admin requests.
 */
function attachImpersonationContext(req, decoded, res) {
  if (!decoded || decoded.impersonation !== true) return;

  const sessionId = str(decoded.impersonationSessionId);
  const mode = IMPERSONATION_MODES.has(str(decoded.impersonationMode))
    ? str(decoded.impersonationMode)
    : "support";

  req.impersonation = {
    sessionId: sessionId || null,
    mode,
    impersonatedClinicId: req.clinicId || decoded.clinicId || null,
    impersonatedByUserId: decoded.impersonatedByUserId || null,
    impersonatedBy: str(decoded.impersonatedBy || decoded.email),
    impersonationStartedAt: decoded.impersonationStartedAt || null,
  };

  if (req.admin && typeof req.admin === "object") {
    req.admin.impersonating = true;
    req.admin.impersonationMode = mode;
    req.admin.impersonationSessionId = sessionId || null;
  }

  if (!MUTATION_METHODS.has(String(req.method || "").toUpperCase())) return;

  const supabase = req.app?.locals?.supabaseForImpersonation;
  const logFn = req.app?.locals?.logImpersonationMutation;
  if (typeof logFn !== "function") return;

  res.on("finish", () => {
    const status = res.statusCode;
    if (status < 200 || status >= 400) return;
    logFn({
      supabase,
      req,
      resourcePath: req.path,
      method: req.method,
    }).catch((e) => console.error("[impersonation] mutation audit:", e?.message || e));
  });
}

async function logImpersonationMutation({ supabase, req, resourcePath, method }) {
  const imp = req.impersonation;
  if (!imp) return;
  const clinic = req.clinic || {};
  await insertAuditLog(supabase, {
    session_id: imp.sessionId,
    actor_email: imp.impersonatedBy,
    actor_user_id: imp.impersonatedByUserId,
    action: "impersonation_data_modified",
    clinic_id: imp.impersonatedClinicId,
    resource_type: "http",
    resource_id: `${method} ${resourcePath}`,
    metadata: {
      method,
      path: resourcePath,
      clinicName: clinic.name || null,
      clinicCode: clinic.clinic_code || req.clinicCode || null,
      mode: imp.mode,
    },
  });
}

/**
 * @param {import("express").Express} app
 * @param {{ superAdminGuard: Function, requireAdminAuth: Function, supabase: object, jwt: object, JWT_SECRET: string, getClinicById?: Function }} deps
 */
function registerSuperAdminImpersonationRoutes(app, deps) {
  const { superAdminGuard, requireAdminAuth, supabase, jwt, JWT_SECRET, getClinicById } = deps;

  app.locals.supabaseForImpersonation = supabase;
  app.locals.logImpersonationMutation = logImpersonationMutation;

  app.post("/api/super-admin/clinics/:clinicId/impersonate", superAdminGuard, async (req, res) => {
    try {
      const clinicId = str(req.params.clinicId);
      if (!UUID_RE.test(clinicId)) {
        return res.status(400).json({ ok: false, error: "invalid_clinic_id" });
      }

      const body = req.body && typeof req.body === "object" ? req.body : {};
      const requestedMode = str(body.mode || "support").toLowerCase();
      if (requestedMode === "view_only") {
        return res.status(400).json({
          ok: false,
          error: "view_only_not_enabled",
          message: "View-only impersonation is not enabled yet. Use support mode.",
        });
      }
      const mode = "support";

      let clinic = null;
      if (typeof getClinicById === "function") {
        clinic = await getClinicById(clinicId);
      } else if (supabase) {
        const { data, error } = await supabase
          .from("clinics")
          .select("id, name, clinic_code, status, email")
          .eq("id", clinicId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        clinic = data;
      }

      if (!clinic) {
        return res.status(404).json({ ok: false, error: "clinic_not_found" });
      }

      const status = str(clinic.status).toUpperCase();
      if (status === "SUSPENDED") {
        return res.status(403).json({
          ok: false,
          error: "clinic_suspended",
          message: "Cannot impersonate a suspended clinic.",
        });
      }

      const actor = resolveSuperAdminActor(req.superAdmin);
      const clinicCode = str(clinic.clinic_code).toUpperCase();
      if (!clinicCode) {
        return res.status(400).json({ ok: false, error: "clinic_code_missing" });
      }

      const session = await createImpersonationSession(supabase, {
        clinicId,
        actorEmail: actor.email,
        actorUserId: actor.userId,
        mode,
        metadata: { clinicCode, clinicName: clinic.name },
      });

      const startedAt = session.startedAt || new Date().toISOString();
      const tokenPayload = {
        type: "admin",
        role: "ADMIN",
        clinicCode,
        clinicId,
        adminId: actor.userId || actor.email,
        email: actor.email,
        impersonation: true,
        impersonationSessionId: session.sessionId,
        impersonationMode: mode,
        impersonatedBy: actor.email,
        impersonatedByUserId: actor.userId,
        impersonationStartedAt: startedAt,
      };

      const token = buildImpersonationAdminToken(jwt, JWT_SECRET, tokenPayload);
      const timestamp = new Date(startedAt).toISOString().replace("T", " ").slice(0, 16);

      await insertAuditLog(supabase, {
        session_id: session.sessionId,
        actor_email: actor.email,
        actor_user_id: actor.userId,
        action: "impersonation_started",
        clinic_id: clinicId,
        resource_type: "clinic",
        resource_id: clinicId,
        metadata: {
          clinicName: clinic.name,
          clinicCode,
          mode,
          summary: formatAuditSummary({
            actorDisplayName: actor.displayName,
            action: "Started clinic impersonation",
            clinicName: clinic.name,
            timestamp,
          }),
        },
      });

      return res.json({
        ok: true,
        token,
        clinicId,
        clinicCode,
        clinicName: clinic.name || clinicCode,
        sessionId: session.sessionId,
        mode,
        impersonationStartedAt: startedAt,
        redirectUrl: resolveImpersonationRedirectUrl(),
        actor: { email: actor.email, displayName: actor.displayName },
      });
    } catch (e) {
      console.error("[POST /api/super-admin/clinics/:clinicId/impersonate]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error", message: e?.message || "error" });
    }
  });

  app.post("/api/super-admin/impersonation/end", superAdminGuard, async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const sessionId = str(body.sessionId);
      const actor = resolveSuperAdminActor(req.superAdmin);

      if (sessionId && UUID_RE.test(sessionId)) {
        await endImpersonationSession(supabase, sessionId);
        await insertAuditLog(supabase, {
          session_id: sessionId,
          actor_email: actor.email,
          actor_user_id: actor.userId,
          action: "impersonation_ended",
          clinic_id: body.clinicId && UUID_RE.test(str(body.clinicId)) ? str(body.clinicId) : null,
          metadata: {
            endedBy: "super_admin_api",
            clinicName: str(body.clinicName) || null,
          },
        });
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error("[POST /api/super-admin/impersonation/end]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.get("/api/admin/impersonation/status", requireAdminAuth, async (req, res) => {
    try {
      if (!req.impersonation) {
        return res.json({ ok: true, active: false });
      }
      const imp = req.impersonation;
      const clinicName = str(req.clinic?.name) || str(req.clinicCode) || "Clinic";
      return res.json({
        ok: true,
        active: true,
        sessionId: imp.sessionId,
        mode: imp.mode,
        clinicId: imp.impersonatedClinicId,
        clinicName,
        clinicCode: req.clinicCode || null,
        impersonatedBy: imp.impersonatedBy,
        impersonationStartedAt: imp.impersonationStartedAt,
      });
    } catch (e) {
      console.error("[GET /api/admin/impersonation/status]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.post("/api/admin/impersonation/end", requireAdminAuth, async (req, res) => {
    try {
      if (!req.impersonation) {
        return res.status(400).json({ ok: false, error: "not_impersonating" });
      }

      const imp = req.impersonation;
      const actor = resolveSuperAdminActor({
        email: imp.impersonatedBy,
        userId: imp.impersonatedByUserId,
      });

      if (imp.sessionId) {
        await endImpersonationSession(supabase, imp.sessionId);
      }

      const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
      await insertAuditLog(supabase, {
        session_id: imp.sessionId,
        actor_email: actor.email,
        actor_user_id: actor.userId,
        action: "impersonation_ended",
        clinic_id: imp.impersonatedClinicId,
        metadata: {
          clinicName: req.clinic?.name || null,
          endedBy: "clinic_ui",
          summary: formatAuditSummary({
            actorDisplayName: actor.displayName,
            action: "Ended clinic impersonation",
            clinicName: req.clinic?.name,
            timestamp,
          }),
        },
      });

      return res.json({ ok: true, redirectUrl: "/super-admin.html" });
    } catch (e) {
      console.error("[POST /api/admin/impersonation/end]", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });
}

module.exports = {
  registerSuperAdminImpersonationRoutes,
  attachImpersonationContext,
  resolveSuperAdminActor,
  IMPERSONATION_MODES,
};
