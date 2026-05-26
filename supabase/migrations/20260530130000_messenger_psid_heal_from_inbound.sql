-- One-time heal: replace truncated Messenger PSIDs (8-digit bug) from latest inbound channel message.

UPDATE public.channel_identities ci
SET
  external_user_id = sub.full_psid,
  updated_at = now()
FROM (
  SELECT DISTINCT ON (ci2.id)
    ci2.id AS identity_id,
    trim(cm.metadata->>'psid') AS full_psid
  FROM public.channel_identities ci2
  INNER JOIN public.ai_coordinator_lead_profiles lp
    ON lp.patient_id = ci2.patient_id
   AND lp.clinic_id = ci2.clinic_id
  INNER JOIN public.ai_coordinator_channel_messages cm
    ON cm.profile_id = lp.id
   AND cm.channel = 'messenger'
   AND cm.direction = 'inbound'
  WHERE ci2.channel = 'messenger'
    AND length(trim(ci2.external_user_id)) < 12
    AND length(trim(cm.metadata->>'psid')) >= 12
    AND trim(cm.metadata->>'psid') ~ '^\d{12,20}$'
  ORDER BY ci2.id, cm.created_at DESC
) sub
WHERE ci.id = sub.identity_id
  AND sub.full_psid IS NOT NULL
  AND sub.full_psid <> ci.external_user_id;

UPDATE public.ai_coordinator_lead_profiles lp
SET
  channel_metadata = jsonb_set(
    jsonb_set(
      COALESCE(lp.channel_metadata, '{}'::jsonb),
      '{messenger_psid}',
      to_jsonb(trim(cm.metadata->>'psid')),
      true
    ),
    '{messenger_psid_raw}',
    to_jsonb(trim(cm.metadata->>'psid_raw')),
    true
  ),
  updated_at = now()
FROM public.ai_coordinator_channel_messages cm
WHERE cm.profile_id = lp.id
  AND cm.channel = 'messenger'
  AND cm.direction = 'inbound'
  AND length(trim(cm.metadata->>'psid')) >= 12
  AND (
    lp.channel_metadata->>'messenger_psid' IS NULL
    OR length(trim(lp.channel_metadata->>'messenger_psid')) < 12
  )
  AND cm.created_at = (
    SELECT max(cm2.created_at)
    FROM public.ai_coordinator_channel_messages cm2
    WHERE cm2.profile_id = lp.id
      AND cm2.channel = 'messenger'
      AND cm2.direction = 'inbound'
  );
