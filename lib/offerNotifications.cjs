/**
 * Offer / treatment-request messaging — Expo push + unread tallies.
 * Wired from index.cjs after offer_messages insert and treatment_offers create.
 */
function createOfferNotifications(ctx) {
  const {
    supabase,
    UUID_RE,
    pushLog,
    sendExpoToEntity,
    truncateChatPreview,
    countOfferMessagesByRoleForInbox,
    countUnreadPatientMessagesByOfferIds,
    resolveMessagesPatientDbId,
    doctorKeysForUuidFkInQuery,
    isSupabaseEnabled,
    tryClaimChatPushDispatch,
    buildChatPushDedupeKey,
    buildMessagePushDataPayload,
    PATIENT_INBOUND_DOCTOR_PUSH_TYPE = "patient_inbound",
    getDoctorChatUnreadForPushBadge,
    getPatientChatUnreadForPushBadge,
    treatmentRequestPatientIdFilters,
    bumpUnreadCountsCache,
    resolveOperationalDoctorForPatientClinic,
    listDoctorLeadMessagingOffers,
    isCoordinationPlaceholderOffer,
  } = ctx;

  async function countDoctorOfferUnreadTotal(doctorKey, clinicId) {
    if (!isSupabaseEnabled() || !doctorKey) return 0;
    try {
      const doctorKeys = await doctorKeysForUuidFkInQuery([doctorKey].filter(Boolean));
      const doctorIdList = [...new Set([doctorKey, ...doctorKeys].map((k) => String(k || "").trim()).filter(Boolean))];
      const doctorIdMatchSet = new Set(doctorIdList);
      let offers = [];
      if (typeof listDoctorLeadMessagingOffers === "function") {
        offers = await listDoctorLeadMessagingOffers(supabase, {
          doctorIdList,
          doctorIdMatchSet,
          clinicId: clinicId && UUID_RE.test(String(clinicId)) ? String(clinicId) : "",
          isCoordinationPlaceholderOffer,
        });
      } else {
        let q = supabase.from("treatment_offers").select("id").eq("doctor_id", doctorKey);
        if (clinicId && UUID_RE.test(String(clinicId))) {
          q = q.or(`clinic_id.eq.${String(clinicId)},clinic_id.is.null`);
        }
        const { data: offerRows, error } = await q.limit(400);
        if (error || !offerRows?.length) return 0;
        offers = offerRows;
      }
      const ids = offers.map((o) => String(o.id || "").trim()).filter((id) => UUID_RE.test(id));
      if (!ids.length) return 0;
      const map = await countUnreadPatientMessagesByOfferIds(ids, {
        clinicId: clinicId && UUID_RE.test(String(clinicId)) ? String(clinicId) : undefined,
      });
      return Object.values(map).reduce((s, n) => s + (Number(n) || 0), 0);
    } catch (e) {
      pushLog.warn("offer_unread.doctor_count_fail", { message: String(e?.message || e).slice(0, 120) });
      return 0;
    }
  }

  async function countPatientOfferInboxUnread(tokenPatientId, resolvedUuid) {
    const patientIdFilters = treatmentRequestPatientIdFilters(tokenPatientId, resolvedUuid);
    if (!patientIdFilters.length) {
      return { newOffers: 0, doctorMessages: 0, total: 0 };
    }

    let offerQ = supabase
      .from("treatment_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "answered")
      .is("patient_seen_at", null);
    offerQ =
      patientIdFilters.length === 1
        ? offerQ.eq("patient_id", patientIdFilters[0])
        : offerQ.in("patient_id", patientIdFilters);
    const { count: newOffers } = await offerQ;

    let doctorMessages = 0;
    let reqsQ = supabase.from("treatment_requests").select("id");
    reqsQ =
      patientIdFilters.length === 1
        ? reqsQ.eq("patient_id", patientIdFilters[0])
        : reqsQ.in("patient_id", patientIdFilters);
    const { data: reqs } = await reqsQ;
    if (reqs?.length) {
      const reqIds = reqs.map((r) => r.id);
      const { data: offerRows } = await supabase.from("treatment_offers").select("id").in("request_id", reqIds);
      if (offerRows?.length) {
        const offerIds = offerRows.map((o) => o.id);
        doctorMessages = await countOfferMessagesByRoleForInbox(offerIds, "doctor");
      }
    }

    const newN = Number(newOffers) || 0;
    const docN = Number(doctorMessages) || 0;
    return { newOffers: newN, doctorMessages: docN, total: newN + docN };
  }

  async function getDoctorCombinedUnreadForPushBadge(doctorUuid, clinicId) {
    const chat = await getDoctorChatUnreadForPushBadge(doctorUuid);
    const keys = await doctorKeysForUuidFkInQuery([doctorUuid].filter(Boolean));
    const doctorKey = keys[0] || doctorUuid;
    const offer = await countDoctorOfferUnreadTotal(doctorKey, clinicId);
    return Math.min(999999, (Number(chat) || 0) + (Number(offer) || 0));
  }

  async function getPatientCombinedUnreadForPushBadge(tokenPatientId, resolvedUuid) {
    const chat = resolvedUuid ? await getPatientChatUnreadForPushBadge(resolvedUuid) : 0;
    const offer = await countPatientOfferInboxUnread(tokenPatientId, resolvedUuid);
    return Math.min(999999, (Number(chat) || 0) + (Number(offer.total) || 0));
  }

  function logOfferEvent(event, fields) {
    pushLog.info(event, fields);
  }

  /** Canonical routing hints for mobile push taps (offer-chat vs patient-chat). */
  async function resolveOfferPushCanonicalMeta(tr) {
    const patientId = String(tr?.patient_id || "").trim();
    const clinicId = tr?.clinic_id ? String(tr.clinic_id).trim() : "";
    let enrolled = false;
    if (UUID_RE.test(patientId) && UUID_RE.test(clinicId)) {
      try {
        const { data: prow } = await supabase
          .from("patients")
          .select("clinic_id, is_lead")
          .eq("id", patientId)
          .maybeSingle();
        if (
          prow?.clinic_id &&
          String(prow.clinic_id).trim().toLowerCase() === clinicId.toLowerCase() &&
          prow.is_lead === false
        ) {
          enrolled = true;
        }
        if (!enrolled) {
          const { data: trows } = await supabase
            .from("patient_chat_threads")
            .select("is_lead, updated_at")
            .eq("patient_id", patientId)
            .eq("clinic_id", clinicId)
            .order("updated_at", { ascending: false })
            .limit(3);
          for (const thr of trows || []) {
            if (thr?.is_lead === false) {
              enrolled = true;
              break;
            }
          }
        }
      } catch (e) {
        pushLog.warn("offer_push.canonical_meta_fail", {
          message: String(e?.message || e).slice(0, 100),
        });
      }
    }
    return {
      enrolled,
      route: enrolled ? "patient_chat" : "offer_chat",
      lead_thread_is_lead: enrolled ? false : true,
    };
  }

  async function enqueueOfferMessagePush({
    actor,
    offerId,
    tr,
    messageRow,
    doctorRow,
    sourceMessageStableId,
  }) {
    if (!messageRow?.id) return;

    const preview = truncateChatPreview(messageRow.text || "[attachment]");
    const senderName = String(messageRow.sender_name || "").trim() || (actor.kind === "doctor" ? "Doctor" : "Patient");

    try {
      if (actor.kind === "patient") {
        const fallbackDoctorId = String(doctorRow?.doctor_id || doctorRow?.id || "").trim();
        const clinicId = tr?.clinic_id ? String(tr.clinic_id).trim() : "";
        const patientId = tr?.patient_id ? String(tr.patient_id).trim() : "";
        let doctorId = fallbackDoctorId;
        if (
          typeof resolveOperationalDoctorForPatientClinic === "function" &&
          UUID_RE.test(patientId) &&
          UUID_RE.test(clinicId)
        ) {
          const operational = await resolveOperationalDoctorForPatientClinic(supabase, {
            patientId,
            clinicId,
            fallbackDoctorId,
          });
          if (operational && UUID_RE.test(operational)) {
            doctorId = operational;
          }
        }
        if (!doctorId || !UUID_RE.test(doctorId)) {
          logOfferEvent("offer_push_skipped_no_doctor", { offerId, patientId: patientId.slice(0, 8) });
          return;
        }

        const offerMsgStableId = `offer_msg:${String(messageRow.id)}`;
        const inboundStableId = sourceMessageStableId
          ? String(sourceMessageStableId).trim()
          : offerMsgStableId;
        const stableId = inboundStableId || offerMsgStableId;
        const dedupeKey = buildChatPushDedupeKey({
          recipientKind: "doctor",
          recipientId: doctorId,
          messageStableId: stableId,
          notificationType: PATIENT_INBOUND_DOCTOR_PUSH_TYPE,
        });
        if (!dedupeKey) {
          logOfferEvent("offer_push_skipped_empty_dedupe", { offerId, doctorId: doctorId.slice(0, 8) });
          return;
        }
        if (
          !(await tryClaimChatPushDispatch({
            dedupeKey,
            messageStableId: stableId,
            messageRowId: String(messageRow.id),
            recipientKind: "doctor",
            recipientId: doctorId,
            notificationType: PATIENT_INBOUND_DOCTOR_PUSH_TYPE,
          }))
        ) {
          logOfferEvent("offer_push_skipped_dedupe", { offerId, messageId: messageRow.id });
          return;
        }

        const badge = await getDoctorCombinedUnreadForPushBadge(doctorId, clinicId || null);
        const canonical = await resolveOfferPushCanonicalMeta(tr);
        const patientPk = tr?.patient_id ? String(tr.patient_id) : "";
        const patientNameForLink = senderName || "Patient";
        const deepLink =
          canonical.route === "patient_chat" && patientPk
            ? `/doctor/patient-chat?patientId=${encodeURIComponent(patientPk)}&patientName=${encodeURIComponent(patientNameForLink)}`
            : `/offer-chat?offerId=${encodeURIComponent(String(offerId))}&otherName=${encodeURIComponent(patientNameForLink)}`;
        const pushData = buildMessagePushDataPayload({
          type: "offer_message",
          messageId: String(messageRow.id),
          threadId: offerId,
          conversationId: offerId,
          requestId: tr?.id ? String(tr.id) : null,
          offerId,
          patientId: patientPk || null,
          senderName,
          senderRole: "patient",
          preview,
          route: canonical.route,
          enrolled: canonical.enrolled,
          leadThreadIsLead: canonical.lead_thread_is_lead,
          url: deepLink,
        });
        pushData.unreadBadge = String(badge);
        await sendExpoToEntity("doctor", doctorId, {
          title: senderName,
          body: preview,
          badge,
          data: pushData,
        });
        logOfferEvent("offer_push_sent", {
          kind: "offer_message",
          recipient: "doctor",
          offerId,
          doctorId: doctorId.slice(0, 8),
        });
        logOfferEvent("offer_unread_increment", { recipient: "doctor", offerId });
      } else {
        const tokenPatientId = String(tr?.patient_id || "").trim();
        const resolved = await resolveMessagesPatientDbId(tokenPatientId);
        if (!resolved) {
          logOfferEvent("offer_push_skipped_no_patient", { offerId });
          return;
        }
        const offerMsgStableId = `offer_msg:${String(messageRow.id)}`;
        const dedupeKey = buildChatPushDedupeKey({
          recipientKind: "patient",
          recipientId: resolved,
          messageStableId: offerMsgStableId,
          notificationType: "offer_message",
        });
        if (
          !dedupeKey ||
          !(await tryClaimChatPushDispatch({
            dedupeKey,
            messageStableId: offerMsgStableId,
            messageRowId: String(messageRow.id),
            recipientKind: "patient",
            recipientId: resolved,
            notificationType: "offer_message",
          }))
        ) {
          logOfferEvent("offer_push_skipped_dedupe", { offerId, messageId: messageRow.id });
          return;
        }
        const badge = await getPatientCombinedUnreadForPushBadge(tokenPatientId, resolved);
        const canonical = await resolveOfferPushCanonicalMeta(tr);
        const pushData = buildMessagePushDataPayload({
          type: "offer_message",
          messageId: String(messageRow.id),
          threadId: offerId,
          conversationId: offerId,
          requestId: tr?.id ? String(tr.id) : null,
          offerId,
          patientId: resolved,
          senderName,
          senderRole: "doctor",
          preview,
          route: canonical.route,
          enrolled: canonical.enrolled,
          leadThreadIsLead: canonical.lead_thread_is_lead,
        });
        pushData.unreadBadge = String(badge);
        await sendExpoToEntity("patient", resolved, {
          title: senderName,
          body: preview,
          badge,
          data: pushData,
        });
        logOfferEvent("offer_push_sent", {
          kind: "offer_message",
          recipient: "patient",
          offerId,
          patientId: resolved.slice(0, 8),
        });
        logOfferEvent("offer_unread_increment", { recipient: "patient", offerId });
      }
    } catch (e) {
      pushLog.warn("offer_push_failed", {
        offerId,
        message: String(e?.message || e).slice(0, 160),
      });
    }
  }

  async function enqueueNewOfferPush({ offerId, requestId, tr, doctorName }) {
    const tokenPatientId = String(tr?.patient_id || "").trim();
    const resolved = await resolveMessagesPatientDbId(tokenPatientId);
    if (!resolved) return;

    const stableId = `offer_new:${String(offerId || requestId)}`;
    const dedupeKey = buildChatPushDedupeKey({
      recipientKind: "patient",
      recipientId: resolved,
      messageStableId: stableId,
      notificationType: "new_offer",
    });
    if (
      !(await tryClaimChatPushDispatch({
        dedupeKey,
        messageStableId: stableId,
        recipientKind: "patient",
        recipientId: resolved,
        notificationType: "new_offer",
      }))
    ) {
      return;
    }

    const title = String(doctorName || "Clinic").trim().slice(0, 80) || "Clinic";
    const body = "You have a new treatment offer. Tap to view and reply.";
    try {
      const badge = await getPatientCombinedUnreadForPushBadge(tokenPatientId, resolved);
      const pushData = buildMessagePushDataPayload({
        type: "new_offer",
        threadId: String(offerId || ""),
        conversationId: String(offerId || ""),
        requestId: String(requestId || ""),
        offerId: String(offerId || ""),
        patientId: resolved,
        senderName: title,
        preview: body,
      });
      pushData.unreadBadge = String(badge);
      await sendExpoToEntity("patient", resolved, {
        title,
        body,
        badge,
        data: pushData,
      });
      logOfferEvent("offer_push_sent", { kind: "new_offer", recipient: "patient", offerId, requestId });
      logOfferEvent("offer_unread_increment", { recipient: "patient", kind: "new_offer" });
    } catch (e) {
      pushLog.warn("offer_push_new_offer_failed", { message: String(e?.message || e).slice(0, 160) });
    }
  }

  async function afterOfferMessagesMarkedRead(actor, access) {
    try {
      if (actor.kind === "doctor" && access?.tr?.clinic_id) {
        bumpUnreadCountsCache(String(access.tr.clinic_id));
      } else {
        bumpUnreadCountsCache(null);
      }
      logOfferEvent("offer_mark_read", {
        offerId: access?.offerId || null,
        actor: actor.kind,
      });
    } catch (_) {
      /* non-fatal */
    }
  }

  return {
    countDoctorOfferUnreadTotal,
    countPatientOfferInboxUnread,
    getDoctorCombinedUnreadForPushBadge,
    getPatientCombinedUnreadForPushBadge,
    enqueueOfferMessagePush,
    enqueueNewOfferPush,
    afterOfferMessagesMarkedRead,
  };
}

module.exports = { createOfferNotifications };
