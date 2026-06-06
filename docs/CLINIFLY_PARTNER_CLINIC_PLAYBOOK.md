# Clinifly Partner Clinic Playbook

**Purpose:** Train the Clinifly AI assistant to answer dental clinic questions consistently, professionally, and in a sales-oriented way — like a knowledgeable clinic onboarding and partnership specialist, not a generic chatbot.

**Positioning:** A system that helps clinics attract patients, respond faster, communicate in multiple languages, and convert more inquiries into appointments.

This is **not** a technical FAQ. It covers clinic acquisition, onboarding, marketplace presence, and objection handling.

---

## Language rules (critical)

**Use simple, direct clinic-owner language:**
- More patient inquiries • More appointments • Faster responses • Less workload for staff
- International patients • 24/7 availability • Communication in 20+ languages

**Avoid platform jargon:**
- workflow automation • omnichannel communication • digital ecosystem • operational efficiency • SaaS terminology

**Example — prefer:**
> "Clinifly can answer patient messages from WhatsApp, Messenger, and Clinifly 24/7, helping you turn more inquiries into appointments."

**Not:**
> "Clinifly centralizes patient communication across multiple channels."

**Never** promise guaranteed patient numbers, revenue, or treatment sales.

---

## Seven key messages (English)

1. **Patient acquisition:** Clinifly helps patients discover your clinic and contact you directly.
2. **Inquiry → appointment:** Our goal is not only to receive messages, but to help convert patient inquiries into appointments.
3. **AI assistant:** The AI can answer patient questions, request photos, provide treatment information, and continue conversations 24/7.
4. **Human handover:** Your team can join or take over conversations whenever they want.
5. **Multilingual:** Clinifly AI can communicate in more than 20 languages — international patients without language barriers.
6. **Staff efficiency:** Patients receive answers immediately; your staff spends less time on repetitive questions.
7. **Dental tourism:** International patients can ask questions, send photos, receive information, and communicate before traveling.

---

## Playbook sections

| Section key | Topic |
|-------------|--------|
| `patient_acquisition` | How Clinifly helps clinics get more patients |
| `international_dental_tourism` | Foreign patients, dental tourism, cross-border inquiries |
| `ai_assistant` | What AI does, WhatsApp/Messenger, human handoff, training |
| `clinic_profile_marketplace` | Profile completeness, reviews, photos, visibility |
| `referral_system` | Patient referrals and word-of-mouth growth |
| `pricing_membership` | Free trial, plans, included features |
| `objection_handling` | WhatsApp, Instagram, Google, guarantees, “another platform” |

---

## Schema

Table: `clinifly_partner_clinic_playbook_entries`

| Column | Description |
|--------|-------------|
| `id` | Stable key (e.g. `playbook.en.001`) |
| `section` | One of the seven section keys above |
| `intent` | Intent slug for retrieval grouping |
| `question` | Canonical clinic-facing question |
| `question_aliases` | Alternate phrasings for matching |
| `short_answer` | 1–3 sentence sales reply (primary AI source) |
| `detailed_answer` | Expanded objection-handling copy |
| `language` | `en`, `ka`, `tr`, or `ru` |
| `priority` | Retrieval rank (higher = preferred) |
| `sort_order` | Order within section |
| `tags` | Keyword tags for fuzzy matching |

---

## Content rules

- Focus on **business value**: visibility, patient communication, international reach, clinic growth
- **Never** promise guaranteed patient numbers or revenue
- Honest, realistic, confidence-building tone
- Complements legacy `clinifly_sales_kb_entries` (pricing facts, market lists)

---

## Source of truth

| Asset | Path |
|-------|------|
| Canonical data (50 EN entries) | `lib/cliniflyPartnerClinicPlaybookData.js` |
| Loader / cache | `lib/cliniflyPartnerClinicPlaybook.js` |
| Sales AI retrieval | `lib/cliniflySalesKnowledge.js` → `lib/cliniflySalesAi.js` |
| Migration | `supabase/migrations/20260610140000_clinifly_partner_clinic_playbook.sql` |
| Seed script | `node scripts/seed-partner-clinic-playbook.cjs` |
| Re-emit SQL | `node scripts/seed-partner-clinic-playbook.cjs --emit-sql` |

---

## English library (50 questions)

### 1. Patient Acquisition (8)

1. How does Clinifly help me get more patients?
2. What is Clinifly in one sentence for dental clinics?
3. How do international patients find my clinic?
4. Why should I list my clinic on Clinifly?
5. What makes Clinifly different from Google, Facebook, or Instagram?
6. How does Clinifly help turn patient inquiries into appointments?
7. What acquisition channels does Clinifly support?
8. Can Clinifly communicate with patients in different languages?

### 2. International Patients & Dental Tourism (8)

9. How can Clinifly help with dental tourism?
10. How do foreign patients contact my clinic?
11. How can I receive treatment requests from other countries?
12. Which countries does Clinifly focus on?
13. How does Clinifly handle language barriers?
14. Can Clinifly collect photos before international patients travel?
15. How does Clinifly support travel and stay coordination?
16. Is Clinifly built for cross-border dental treatment?

### 3. AI Assistant (7)

17. What does the AI assistant do?
18. Can it answer WhatsApp and Messenger messages?
19. Can my team take over conversations?
20. How is the AI trained?
21. Does the AI replace my coordinators?
22. How does the AI handle after-hours messages?
23. Can the AI qualify leads before my team steps in?

### 4. Clinic Profile & Marketplace (7)

24. Why should I complete my clinic profile?
25. How do reviews, social media links, doctors, and photos help?
26. How does Clinifly improve clinic visibility?
27. What is the Clinifly clinic marketplace?
28. How do patients discover my clinic on Clinifly?
29. Does a complete profile improve trust with international patients?
30. Can I showcase doctors and treatments on my profile?

### 5. Referral System (5)

31. How does the referral system work?
32. How can existing patients help attract new patients?
33. Can we run referral campaigns?
34. How are referrals tracked?
35. Why are referrals better than informal word-of-mouth?

### 6. Pricing & Membership (7)

36. Is Clinifly free?
37. What features are included?
38. Are there future paid plans?
39. Is there a free trial?
40. Do I need a credit card to start?
41. Are patient apps free?
42. What is the difference between Pro and Premium?

### 7. Objection Handling (8)

43. I already use WhatsApp.
44. I already have Instagram.
45. I already get patients from Google.
46. How many patients will Clinifly bring me?
47. Why should I join another platform?
48. My patients won't download an app.
49. We're too busy to set up new software.
50. Clinifly sounds too good to be true — is it?

---

## Adding translations

Add rows with the same `intent` and `section`, translated `question` / `short_answer` / `detailed_answer`, and `language` set to `ka`, `tr`, or `ru`. Use ids like `playbook.ka.001`.

---

## Related docs

- [`CLINIFLY_ONBOARDING_SUPPORT_KB.md`](CLINIFLY_ONBOARDING_SUPPORT_KB.md) — admin UI setup help (separate table)
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — Railway deploy
