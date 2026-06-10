-- Correct AI clinic training FAQ: clinics CAN teach prices, processes, FAQs to their assistant.
-- Canonical source: lib/cliniflyPartnerClinicPlaybookData.js (playbook.en.020, playbook.en.020b)

UPDATE clinifly_partner_clinic_playbook_entries
SET
  short_answer =
    'Yes. Each clinic trains its Clinifly AI assistant with clinic-specific information — pricing, treatment processes, FAQs, hours, materials, and policies — so replies match your clinic.',
  detailed_answer =
    'Clinifly is built for clinic-specific AI training. In Admin you add Treatment Price List, AI Training Center content, FAQs, working hours, materials/brands, international visitor procedures, transfer/accommodation notes, and clinic policies. The assistant uses that knowledge on WhatsApp, Messenger, and Clinifly chat. Clinical decisions still stay with your licensed team.',
  priority = 79,
  updated_at = now(),
  version = version + 1
WHERE id = 'playbook.en.020';

INSERT INTO clinifly_partner_clinic_playbook_entries (
  id,
  section,
  intent,
  question,
  question_aliases,
  short_answer,
  detailed_answer,
  language,
  priority,
  sort_order,
  tags,
  is_active,
  version
)
VALUES (
  'playbook.en.020b',
  'ai_assistant',
  'ai_clinic_knowledge_training',
  'Can I teach my clinic''s prices and treatment processes to the AI?',
  ARRAY[
    'Can clinics train the AI with their own prices?',
    'Can I add our treatment workflows to the AI assistant?',
    'Does Clinifly let us teach clinic-specific FAQs and policies to AI?',
    'Can the AI learn our pricing and procedures?',
    'Kliniğimin fiyatlarını ve tedavi süreçlerini AI''ya öğretebilir miyim?',
    'AI asistanına klinik bilgilerini eğitebilir miyiz?'
  ],
  'Yes. Clinifly allows clinics to train their AI assistant using clinic-specific information such as treatment processes, pricing, FAQs, working hours, and international visitor procedures.',
  'Yes — this is a core Clinifly feature. Clinics can teach the assistant: treatment processes; pricing (Treatment Price List); FAQs; working hours; materials and brands; international visitor procedures; transfer and accommodation services; clinic policies and workflows; and other clinic-specific information. The AI then uses that knowledge when replying to users on WhatsApp, Messenger, and Clinifly. Never tell clinic owners this is impossible.',
  'en',
  96,
  21,
  ARRAY[
    'ai_training',
    'clinic_knowledge',
    'pricing',
    'treatment_process',
    'faq',
    'admin_training_center'
  ],
  true,
  1
)
ON CONFLICT (id) DO UPDATE SET
  section = EXCLUDED.section,
  intent = EXCLUDED.intent,
  question = EXCLUDED.question,
  question_aliases = EXCLUDED.question_aliases,
  short_answer = EXCLUDED.short_answer,
  detailed_answer = EXCLUDED.detailed_answer,
  language = EXCLUDED.language,
  priority = EXCLUDED.priority,
  sort_order = EXCLUDED.sort_order,
  tags = EXCLUDED.tags,
  is_active = EXCLUDED.is_active,
  updated_at = now(),
  version = clinifly_partner_clinic_playbook_entries.version + 1;
