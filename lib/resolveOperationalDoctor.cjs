/**
 * Operational doctor for lead/coordination messaging — thread & patient assignment
 * before placeholder offer.doctor_id (default clinic doctor).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingColumnError(err) {
  const code = String(err?.code || "");
  return code === "42703" || code === "PGRST204";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ patientId: string, clinicId: string, fallbackDoctorId?: string|null }} params
 */
async function resolveOperationalDoctorForPatientClinic(supabase, params) {
  const pid = String(params?.patientId || "").trim();
  const cid = String(params?.clinicId || "").trim();
  const fallback = String(params?.fallbackDoctorId || "").trim();

  if (!UUID_RE.test(pid) || !UUID_RE.test(cid)) {
    return UUID_RE.test(fallback) ? fallback : null;
  }

  try {
    const { data: threads } = await supabase
      .from("patient_chat_threads")
      .select("assigned_doctor_id, is_lead, updated_at")
      .eq("patient_id", pid)
      .eq("clinic_id", cid)
      .order("updated_at", { ascending: false })
      .limit(8);

    for (const thr of threads || []) {
      const aid = String(thr?.assigned_doctor_id || "").trim();
      if (UUID_RE.test(aid)) return aid;
    }

    const patientCols = [
      "assigned_doctor_id",
      "last_assigned_doctor_id",
      "primary_doctor_id",
      "doctor_id",
    ];
    for (const col of patientCols) {
      const { data: prow, error } = await supabase.from("patients").select(col).eq("id", pid).maybeSingle();
      if (error) {
        if (isMissingColumnError(error)) continue;
        break;
      }
      const aid = prow?.[col] != null ? String(prow[col]).trim() : "";
      if (UUID_RE.test(aid)) return aid;
    }
  } catch (_) {
    /* non-fatal */
  }

  return UUID_RE.test(fallback) ? fallback : null;
}

const OFFER_SCOPE_SELECT =
  "id, request_id, treatment_type, created_at, doctor_id, clinic_id, note, price_text, price_range";

/**
 * Offers this doctor should see for lead inbox / unread / push (own offers + coordination
 * placeholders for patients assigned on patient_chat_threads).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ doctorIdList: string[], doctorIdMatchSet: Set<string>, clinicId: string, isCoordinationPlaceholderOffer: (o: object) => boolean, limit?: number }} params
 */
async function listDoctorLeadMessagingOffers(supabase, params) {
  const doctorIdList = Array.isArray(params?.doctorIdList)
    ? params.doctorIdList.map((k) => String(k || "").trim()).filter(Boolean)
    : [];
  const doctorIdMatchSet =
    params?.doctorIdMatchSet instanceof Set ? params.doctorIdMatchSet : new Set(doctorIdList);
  const clinicId = String(params?.clinicId || "").trim();
  const isPlaceholder = params?.isCoordinationPlaceholderOffer;
  const limit = Math.min(500, Math.max(50, Number(params?.limit) || 400));

  if (!doctorIdList.length) return [];

  const byId = new Map();

  const mergeRows = (rows) => {
    for (const o of rows || []) {
      const id = String(o?.id || "").trim();
      if (!UUID_RE.test(id)) continue;
      byId.set(id, o);
    }
  };

  let offerQuery = supabase
    .from("treatment_offers")
    .select(OFFER_SCOPE_SELECT)
    .in("doctor_id", doctorIdList)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (clinicId && UUID_RE.test(clinicId)) {
    offerQuery = offerQuery.or(`clinic_id.eq.${clinicId},clinic_id.is.null`);
  }
  const { data: ownRows, error: ownErr } = await offerQuery;
  if (ownErr) {
    console.warn("[listDoctorLeadMessagingOffers] doctor_id query:", ownErr.message);
  } else {
    mergeRows((ownRows || []).filter((o) => doctorIdMatchSet.has(String(o.doctor_id || "").trim())));
  }

  if (clinicId && UUID_RE.test(clinicId)) {
    try {
      const { data: threads, error: thrErr } = await supabase
        .from("patient_chat_threads")
        .select("patient_id, assigned_doctor_id")
        .eq("clinic_id", clinicId)
        .in("assigned_doctor_id", doctorIdList)
        .not("assigned_doctor_id", "is", null)
        .limit(300);
      if (thrErr) {
        console.warn("[listDoctorLeadMessagingOffers] threads:", thrErr.message);
      } else {
        const patientIds = [
          ...new Set(
            (threads || [])
              .map((t) => String(t.patient_id || "").trim())
              .filter((id) => UUID_RE.test(id)),
          ),
        ];
        for (let i = 0; i < patientIds.length; i += 80) {
          const pChunk = patientIds.slice(i, i + 80);
          const { data: reqs } = await supabase
            .from("treatment_requests")
            .select("id")
            .eq("clinic_id", clinicId)
            .in("patient_id", pChunk)
            .limit(200);
          const reqIds = (reqs || [])
            .map((r) => String(r.id || "").trim())
            .filter((id) => UUID_RE.test(id));
          if (!reqIds.length) continue;
          const { data: coordOffers, error: coordErr } = await supabase
            .from("treatment_offers")
            .select(OFFER_SCOPE_SELECT)
            .in("request_id", reqIds)
            .order("created_at", { ascending: false })
            .limit(limit);
          if (coordErr) {
            console.warn("[listDoctorLeadMessagingOffers] coord offers:", coordErr.message);
            continue;
          }
          const rows = (coordOffers || []).filter((o) =>
            typeof isPlaceholder === "function" ? isPlaceholder(o) : false,
          );
          mergeRows(rows);
        }
      }
    } catch (e) {
      console.warn("[listDoctorLeadMessagingOffers] assigned scope:", e?.message || e);
    }
  }

  return [...byId.values()].sort(
    (a, b) => Date.parse(String(b.created_at || 0)) - Date.parse(String(a.created_at || 0)),
  );
}

module.exports = {
  UUID_RE,
  resolveOperationalDoctorForPatientClinic,
  listDoctorLeadMessagingOffers,
};
