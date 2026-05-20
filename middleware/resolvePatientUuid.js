/**
 * Canonical patients.id (UUID) on req.patientUuid for patient-token routes.
 * Resolves legacy p_<uuid> / patients.patient_id via injected resolver.
 */

/**
 * @param {(patientId: string) => Promise<string|null>} resolveFn
 * @returns {import('express').RequestHandler}
 */
function createResolvePatientUuid(resolveFn) {
  return function canonicalPatientUuidMiddleware(req, res, next) {
    const candidate = String(
      req.patientId || req.params?.patientId || req.body?.patientId || "",
    ).trim();

    if (!candidate) {
      return res.status(401).json({
        ok: false,
        error: "invalid_patient",
        code: "invalid_patient",
      });
    }

    Promise.resolve(resolveFn(candidate))
      .then((uuid) => {
        if (!uuid) {
          return res.status(400).json({
            ok: false,
            error: "invalid_patient_id",
            code: "invalid_patient_id",
            message:
              "Unknown patient id. Use patients.id (UUID), p_<uuid>, or a valid patients.patient_id.",
          });
        }
        req.patientUuid = String(uuid);
        return next();
      })
      .catch((err) => {
        console.warn("[canonicalPatientUuid]", err?.message || err);
        return res.status(400).json({
          ok: false,
          error: "invalid_patient_id",
          code: "invalid_patient_id",
        });
      });
  };
}

module.exports = { createResolvePatientUuid };
