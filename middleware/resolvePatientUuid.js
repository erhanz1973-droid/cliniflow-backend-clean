/**
 * After requireToken: sets req.patientUuid to patients.id (UUID).
 * Factory receives resolveMessagesPatientDbId from index.cjs.
 *
 * @param { (raw: string) => Promise<string | null> } resolveMessagesPatientDbId
 */
function createResolvePatientUuid(resolveMessagesPatientDbId) {
  const uuid36 = /^[0-9a-f-]{36}$/i;
  return async function canonicalPatientUuid(req, res, next) {
    try {
      const tokenId = String(req.patientId || "").trim();
      if (uuid36.test(tokenId)) {
        req.patientUuid = tokenId;
        return next();
      }
      const resolvedUuid = await resolveMessagesPatientDbId(tokenId);
      if (!resolvedUuid) {
        console.warn("❌ Could not resolve patient UUID from token:", tokenId);
        return res.status(401).json({ ok: false, error: "invalid_patient" });
      }
      req.patientUuid = resolvedUuid;
      return next();
    } catch (e) {
      console.error("🔥 resolvePatientUuid error:", e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  };
}

module.exports = { createResolvePatientUuid };
