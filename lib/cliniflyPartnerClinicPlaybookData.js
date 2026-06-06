/**
 * Clinifly Partner Clinic Playbook (English)
 * Simple, clinic-owner language — business outcomes, not platform jargon.
 *
 * USE: more patient inquiries, appointments, faster responses, less staff workload,
 * international patients, 24/7 availability, 20+ languages.
 * AVOID: workflow automation, omnichannel, digital ecosystem, operational efficiency, SaaS terms.
 *
 * Positioning: A system that helps clinics attract patients, respond faster, communicate
 * in multiple languages, and convert more inquiries into appointments.
 */

/**
 * @typedef {{
 *   id: string,
 *   section: 'patient_acquisition'|'international_dental_tourism'|'ai_assistant'|'clinic_profile_marketplace'|'referral_system'|'pricing_membership'|'objection_handling',
 *   intent: string,
 *   question: string,
 *   questionAliases: string[],
 *   shortAnswer: string,
 *   detailedAnswer: string,
 *   language: 'en',
 *   priority: number,
 *   sortOrder: number,
 *   tags: string[],
 * }} PartnerClinicPlaybookRow
 */

/** @returns {PartnerClinicPlaybookRow[]} */
function getPartnerClinicPlaybookData() {
  return [
    {
      id: "playbook.en.001",
      section: "patient_acquisition",
      intent: "get_more_patients",
      question: "How does Clinifly help me get more patients?",
      questionAliases: [
        "How will Clinifly bring more patients to my dental clinic?",
        "Can Clinifly help us get more patient inquiries?",
        "How can Clinifly support clinic growth?",
      ],
      shortAnswer:
        "Clinifly helps patients discover your clinic, contact you directly, and get fast answers — so more inquiries can turn into appointments.",
      detailedAnswer:
        "Most clinics lose patients when replies are slow or messages are missed. Clinifly helps you get more patient inquiries, answer 24/7 on WhatsApp, Messenger, and Clinifly, and follow up clearly. Your team spends less time on repetitive questions and more time booking real appointments. Results depend on your clinic and market — we do not guarantee a fixed number of patients.",
      language: "en",
      priority: 98,
      sortOrder: 1,
      tags: ["growth", "new_patients", "appointments", "faster_replies"],
    },
    {
      id: "playbook.en.002",
      section: "patient_acquisition",
      intent: "platform_positioning",
      question: "What is Clinifly in one sentence for dental clinics?",
      questionAliases: [
        "How should we explain Clinifly to our team?",
        "What does Clinifly do for a clinic?",
        "What is Clinifly in one line?",
      ],
      shortAnswer:
        "A system that helps clinics attract patients, respond faster, communicate in multiple languages, and convert more inquiries into appointments.",
      detailedAnswer:
        "If you need one simple explanation, use this: Clinifly helps clinics get more patient inquiries and turn those inquiries into booked visits. It supports quick answers, 24/7 conversations, and communication in more than 20 languages so local and international patients can speak comfortably.",
      language: "en",
      priority: 97,
      sortOrder: 2,
      tags: ["positioning", "overview", "clear_message", "value"],
    },
    {
      id: "playbook.en.003",
      section: "patient_acquisition",
      intent: "visibility_improvement",
      question: "How does Clinifly improve clinic visibility?",
      questionAliases: [
        "How can Clinifly make our clinic easier to find?",
        "Does Clinifly increase online visibility?",
        "Can Clinifly help more patients notice us?",
      ],
      shortAnswer:
        "Clinifly helps more patients discover your clinic and contact you directly.",
      detailedAnswer:
        "When your clinic profile is clear and contact is easy, more patients take action. Clinifly helps patients find your clinic, review key details, and start messaging right away. Better visibility plus fast communication means more real inquiries, not just profile views.",
      language: "en",
      priority: 96,
      sortOrder: 3,
      tags: ["visibility", "discovery", "patient_inquiries", "contact"],
    },
    {
      id: "playbook.en.004",
      section: "patient_acquisition",
      intent: "digital_channel_advantage",
      question:
        "What makes Clinifly different from Google, Facebook, or Instagram?",
      questionAliases: [
        "Why not just use Google and social media?",
        "How is Clinifly different from only running ads?",
        "Is Clinifly more than social channels?",
      ],
      shortAnswer:
        "Google and social apps help people notice you; Clinifly helps you reply faster and turn more messages into appointments.",
      detailedAnswer:
        "Ads and social content can bring attention, but clinics still need fast and consistent patient communication. Clinifly helps with that next step by keeping conversations active 24/7 and guiding patients toward booking. So it is not just about getting messages, it is about converting those messages into visits.",
      language: "en",
      priority: 95,
      sortOrder: 4,
      tags: ["google", "facebook", "instagram", "conversion"],
    },
    {
      id: "playbook.en.005",
      section: "patient_acquisition",
      intent: "new_platform_reason",
      question: "Why should I join another platform?",
      questionAliases: [
        "Why should our clinic add Clinifly?",
        "Do we really need one more tool?",
        "What is the business reason to join Clinifly?",
      ],
      shortAnswer:
        "Because Clinifly helps your team answer faster, reduce chat workload, and book more appointments from existing inquiries.",
      detailedAnswer:
        "Many clinics already receive messages, but slow replies and missed follow-up reduce bookings. Clinifly helps you respond quickly, continue conversations, and request needed details such as photos. That means your staff spends less time repeating the same answers and more time on real patients.",
      language: "en",
      priority: 94,
      sortOrder: 5,
      tags: ["why_join", "faster_response", "less_workload", "more_bookings"],
    },
    {
      id: "playbook.en.006",
      section: "patient_acquisition",
      intent: "inquiry_to_appointment",
      question: "How does Clinifly help turn patient inquiries into appointments?",
      questionAliases: [
        "Can Clinifly convert messages into booked visits?",
        "We get messages but struggle to book — can Clinifly help?",
        "Does Clinifly help with inquiry to appointment conversion?",
      ],
      shortAnswer:
        "Our goal is not only to receive messages, but to help convert patient inquiries into appointments — with fast replies, clear answers, and follow-up your team can continue.",
      detailedAnswer:
        "Many clinics receive inquiries but lose them when follow-up is slow or unclear. Clinifly answers patient questions quickly, asks for photos when needed, shares treatment information, and keeps the chat active 24/7. Your team can step in anytime to close the booking. This improves your chance of turning interest into a real appointment — without promising a fixed number of bookings.",
      language: "en",
      priority: 93,
      sortOrder: 6,
      tags: ["inquiries", "follow_up", "appointment_goal", "staff_support"],
    },
    {
      id: "playbook.en.007",
      section: "patient_acquisition",
      intent: "brand_trust_conversion",
      question: "Can Clinifly help us look more professional to new patients?",
      questionAliases: [
        "Will Clinifly improve first impressions?",
        "Can we build more trust with new patients?",
        "Does presentation affect appointment decisions?",
      ],
      shortAnswer:
        "Yes. Patients see faster, clearer communication, which builds trust from the first message.",
      detailedAnswer:
        "Patients decide quickly which clinic feels reliable. When they get clear answers right away, confidence goes up. Clinifly helps your clinic keep that quality in every first conversation, including nights and weekends, so more patients continue to the booking stage.",
      language: "en",
      priority: 92,
      sortOrder: 7,
      tags: ["trust", "first_impression", "professional_image", "booking"],
    },
    {
      id: "playbook.en.008",
      section: "patient_acquisition",
      intent: "multilingual_communication",
      question: "Can Clinifly communicate with patients in different languages?",
      questionAliases: [
        "Does Clinifly support multiple languages?",
        "Can international patients message in their own language?",
        "How many languages does Clinifly AI speak?",
      ],
      shortAnswer:
        "Clinifly AI can communicate with patients in more than 20 languages, helping clinics work with international patients without language barriers.",
      detailedAnswer:
        "Language is often the first barrier for international patients. Clinifly AI replies in the language the patient uses — including English, Turkish, Russian, Arabic, Georgian, and many others — so your clinic can respond quickly without hiring multilingual staff for every shift. Local patients benefit from the same fast replies.",
      language: "en",
      priority: 91,
      sortOrder: 8,
      tags: ["local_patients", "international_patients", "multi_language", "growth"],
    },
    {
      id: "playbook.en.009",
      section: "international_dental_tourism",
      intent: "international_discovery",
      question: "How do international patients find my clinic?",
      questionAliases: [
        "How can foreign patients discover our clinic?",
        "How does Clinifly connect us with international patients?",
        "Where do overseas dental patients find clinics?",
      ],
      shortAnswer:
        "Clinifly helps international patients discover your clinic and contact you directly.",
      detailedAnswer:
        "Patients traveling for treatment usually compare clinics online before choosing. Clinifly helps your clinic appear clearly and makes it easy to start a conversation immediately. Fast replies in the patient's language help keep their interest strong.",
      language: "en",
      priority: 90,
      sortOrder: 9,
      tags: ["international", "discovery", "dental_tourism", "direct_contact"],
    },
    {
      id: "playbook.en.010",
      section: "international_dental_tourism",
      intent: "dental_tourism_support",
      question: "How can Clinifly help with dental tourism?",
      questionAliases: [
        "What does Clinifly do for dental tourism clinics?",
        "Can Clinifly support cross-border treatment inquiries?",
        "How does Clinifly help before patients travel?",
      ],
      shortAnswer:
        "Clinifly helps international patients ask questions, send photos, and get treatment information before they travel.",
      detailedAnswer:
        "Dental tourism patients need more pre-travel communication than local patients. Clinifly helps your clinic answer questions, gather photos, and explain next steps clearly. This creates smoother planning and helps move more inquiries to confirmed appointments.",
      language: "en",
      priority: 89,
      sortOrder: 10,
      tags: ["dental_tourism", "pre_travel", "photos", "appointments"],
    },
    {
      id: "playbook.en.011",
      section: "international_dental_tourism",
      intent: "foreign_contact_channels",
      question: "How do foreign patients contact my clinic?",
      questionAliases: [
        "How can overseas patients message us easily?",
        "What channels do international patients use to reach clinics?",
        "How does Clinifly simplify contact for foreign patients?",
      ],
      shortAnswer:
        "They can message your clinic through familiar apps like WhatsApp and Messenger, with fast replies from Clinifly AI.",
      detailedAnswer:
        "International patients often use messaging apps first. Clinifly helps your clinic answer from WhatsApp, Messenger, and Clinifly 24/7, so patients do not wait. Quick first contact increases the chance they continue to appointment planning.",
      language: "en",
      priority: 88,
      sortOrder: 11,
      tags: ["whatsapp", "messenger", "international_contact", "24_7"],
    },
    {
      id: "playbook.en.012",
      section: "international_dental_tourism",
      intent: "cross_border_requests",
      question: "How can I receive treatment requests from other countries?",
      questionAliases: [
        "Can Clinifly bring treatment inquiries from abroad?",
        "How do we get dental case requests internationally?",
        "How does Clinifly help with overseas requests?",
      ],
      shortAnswer:
        "Clinifly helps more international patients find your clinic and start treatment conversations quickly.",
      detailedAnswer:
        "To receive requests from abroad, your clinic must be easy to discover and easy to contact. Clinifly supports both, then helps continue the chat with fast answers and clear next steps. This keeps international inquiries active and improves appointment potential.",
      language: "en",
      priority: 87,
      sortOrder: 12,
      tags: ["overseas_requests", "international_growth", "quick_replies", "treatment_info"],
    },
    {
      id: "playbook.en.013",
      section: "international_dental_tourism",
      intent: "international_trust_building",
      question: "How does Clinifly help build trust with international patients?",
      questionAliases: [
        "Can Clinifly make foreign patients feel more confident?",
        "How do we reduce hesitation from overseas patients?",
        "Does better communication improve international trust?",
      ],
      shortAnswer:
        "Fast, clear replies in the patient's language help build trust before travel.",
      detailedAnswer:
        "Patients traveling from another country need confidence before booking. Clinifly helps your clinic answer quickly, explain treatment options clearly, and keep the conversation active. Communication in 20+ languages removes language barriers and helps patients feel understood.",
      language: "en",
      priority: 86,
      sortOrder: 13,
      tags: ["trust", "language_support", "international_confidence", "clear_answers"],
    },
    {
      id: "playbook.en.014",
      section: "international_dental_tourism",
      intent: "tourism_process_clarity",
      question: "Can Clinifly make dental tourism communication more organized?",
      questionAliases: [
        "How can we keep international inquiries clear?",
        "Can Clinifly reduce confusion in cross-border communication?",
        "Does Clinifly help us manage tourism conversations?",
      ],
      shortAnswer:
        "Yes. Clinifly keeps international conversations clearer and easier for your team to handle.",
      detailedAnswer:
        "Dental tourism chats often include many questions over several days. Clinifly helps continue these conversations without losing context, so patients get clear answers and your team spends less time repeating details. Clear communication leads to smoother appointment decisions.",
      language: "en",
      priority: 85,
      sortOrder: 14,
      tags: ["dental_tourism", "clear_communication", "less_confusion", "staff_support"],
    },
    {
      id: "playbook.en.015",
      section: "international_dental_tourism",
      intent: "international_patient_growth",
      question: "Is Clinifly suitable if we want more international patients?",
      questionAliases: [
        "Can Clinifly support a clinic focused on foreign patients?",
        "Is Clinifly useful for dental tourism growth?",
        "Can we use Clinifly to get more overseas inquiries?",
      ],
      shortAnswer:
        "Yes. Clinifly is built to help clinics attract and serve more international patients.",
      detailedAnswer:
        "If your clinic wants more patients from abroad, you need quick replies, language support, and clear communication before they travel. Clinifly helps with all three. International patients can ask questions, send photos, and receive information 24/7 — giving your team a better chance to book appointments.",
      language: "en",
      priority: 84,
      sortOrder: 15,
      tags: ["international_patients", "dental_tourism_growth", "language", "appointments"],
    },
    {
      id: "playbook.en.016",
      section: "international_dental_tourism",
      intent: "international_inquiry_quality",
      question: "How does Clinifly improve the quality of international patient inquiries?",
      questionAliases: [
        "Can Clinifly help us get more serious overseas inquiries?",
        "How do we improve international inquiry quality?",
        "Does Clinifly help us qualify foreign inquiries?",
      ],
      shortAnswer:
        "Clinifly helps patients share better details early, so your team can focus on stronger inquiries.",
      detailedAnswer:
        "Inquiry quality improves when patients get clear guidance from the first message. Clinifly AI can ask useful questions, request photos, and share treatment information before handover to your team. This gives staff better context and saves time on low-intent chats.",
      language: "en",
      priority: 83,
      sortOrder: 16,
      tags: ["inquiry_quality", "photo_request", "better_context", "international"],
    },
    {
      id: "playbook.en.017",
      section: "ai_assistant",
      intent: "ai_assistant_role",
      question: "What does the AI assistant do?",
      questionAliases: [
        "What is the main job of Clinifly AI assistant?",
        "How does the AI assistant help our clinic team?",
        "What tasks can the assistant handle?",
      ],
      shortAnswer:
        "It answers patient questions, asks for photos, shares treatment information, and continues chats 24/7.",
      detailedAnswer:
        "Clinifly AI handles the first part of many patient conversations. It replies instantly, gives helpful information, and keeps patients engaged while your team is busy or offline. Your staff can step in at any time when a personal conversation is needed.",
      language: "en",
      priority: 82,
      sortOrder: 17,
      tags: ["ai_assistant", "24_7_replies", "photos", "treatment_information"],
    },
    {
      id: "playbook.en.018",
      section: "ai_assistant",
      intent: "messaging_channel_coverage",
      question: "Can it answer WhatsApp and Messenger messages?",
      questionAliases: [
        "Does Clinifly AI work on WhatsApp?",
        "Can the assistant reply on Facebook Messenger too?",
        "Will AI support both channels automatically?",
      ],
      shortAnswer:
        "Yes. Clinifly can answer patient messages from WhatsApp, Messenger, and Clinifly 24/7, helping you turn more inquiries into appointments.",
      detailedAnswer:
        "Most patients message where they are already comfortable. Clinifly AI responds on WhatsApp and Messenger right away, so no patient waits for office hours. This faster first reply helps protect interest and improves booking chances.",
      language: "en",
      priority: 81,
      sortOrder: 18,
      tags: ["whatsapp", "messenger", "fast_response", "bookings"],
    },
    {
      id: "playbook.en.019",
      section: "ai_assistant",
      intent: "human_takeover",
      question: "Can my team take over conversations?",
      questionAliases: [
        "Can staff step in when needed?",
        "Do humans stay in control of AI chats?",
        "Can coordinators continue the conversation directly?",
      ],
      shortAnswer:
        "Yes. Your team can join or take over any conversation whenever they want.",
      detailedAnswer:
        "Clinifly AI supports your staff, it does not replace them. Team members can jump into a chat at any point and continue with a personal touch. This gives you both speed from AI and full control from your team.",
      language: "en",
      priority: 80,
      sortOrder: 19,
      tags: ["human_handover", "team_control", "personal_care", "ai_support"],
    },
    {
      id: "playbook.en.020",
      section: "ai_assistant",
      intent: "ai_training_sources",
      question: "How is the AI trained?",
      questionAliases: [
        "Where does Clinifly AI learn clinic answers from?",
        "Can the assistant reflect our clinic messaging style?",
        "Is AI trained for dental patient conversations?",
      ],
      shortAnswer:
        "It is trained for dental clinic conversations so answers stay clear, helpful, and patient-friendly.",
      detailedAnswer:
        "Clinifly AI is prepared to handle common dental inquiry topics, including treatment questions and pre-appointment details. It aims to give simple and consistent answers that match clinic communication needs. Clinical decisions still stay with dentists and your team.",
      language: "en",
      priority: 79,
      sortOrder: 20,
      tags: ["ai_training", "clear_answers", "dental_context", "consistency"],
    },
    {
      id: "playbook.en.021",
      section: "ai_assistant",
      intent: "response_consistency",
      question: "How does the AI keep answers consistent and professional?",
      questionAliases: [
        "Can AI maintain the same quality in every patient reply?",
        "Will Clinifly AI protect our communication standards?",
        "How do we avoid inconsistent staff responses?",
      ],
      shortAnswer:
        "Clinifly AI gives clear and consistent first replies, even when message volume is high.",
      detailedAnswer:
        "During busy hours, reply quality can drop when staff are overloaded. Clinifly AI keeps a stable tone and answers common questions instantly, so patients always receive prompt and clear communication. Your team can then focus on detailed case discussions.",
      language: "en",
      priority: 78,
      sortOrder: 21,
      tags: ["consistent_replies", "professional_tone", "busy_hours", "patient_experience"],
    },
    {
      id: "playbook.en.022",
      section: "ai_assistant",
      intent: "after_hours_ai_coverage",
      question: "Can the AI respond when our clinic is closed?",
      questionAliases: [
        "Does Clinifly AI work after hours?",
        "Can we answer patients outside office times?",
        "Will inquiries wait until morning without Clinifly?",
      ],
      shortAnswer:
        "Yes. Clinifly AI can answer patient messages 24/7, even when your clinic is closed.",
      detailedAnswer:
        "Many patients message at night or from different time zones. Clinifly AI replies immediately, so interest is not lost while your team is offline. By morning, your staff can continue active conversations instead of starting from zero.",
      language: "en",
      priority: 77,
      sortOrder: 22,
      tags: ["after_hours", "24_7", "timezone_support", "active_inquiries"],
    },
    {
      id: "playbook.en.023",
      section: "ai_assistant",
      intent: "ai_and_team_efficiency",
      question: "How does AI improve our team's daily workload?",
      questionAliases: [
        "Can Clinifly reduce repetitive front-desk messaging?",
        "Will AI free up our coordinators' time?",
        "How does AI reduce staff workload?",
      ],
      shortAnswer:
        "Patients receive answers immediately, while your staff spends less time answering repetitive questions.",
      detailedAnswer:
        "Front-desk teams often repeat the same answers all day — prices, hours, treatment basics. Clinifly AI handles those first messages, requests photos, and shares treatment information 24/7. Your staff steps in when a personal conversation is needed. Less repetitive work, more time for patients ready to book.",
      language: "en",
      priority: 76,
      sortOrder: 23,
      tags: ["staff_workload", "repetitive_questions", "time_saving", "appointment_focus"],
    },
    {
      id: "playbook.en.024",
      section: "clinic_profile_marketplace",
      intent: "list_on_clinifly_reason",
      question: "Why should I list my clinic on Clinifly?",
      questionAliases: [
        "What is the benefit of listing our clinic profile?",
        "Why does clinic listing matter on Clinifly?",
        "Will listing help us get more inquiries?",
      ],
      shortAnswer:
        "Listing helps patients discover your clinic and message you directly.",
      detailedAnswer:
        "A clear listing gives patients a quick way to understand your clinic and start a conversation. This shortens the path from interest to inquiry. More visibility plus direct contact can lead to more appointment opportunities.",
      language: "en",
      priority: 75,
      sortOrder: 24,
      tags: ["clinic_listing", "patient_discovery", "direct_messages", "inquiries"],
    },
    {
      id: "playbook.en.025",
      section: "clinic_profile_marketplace",
      intent: "complete_profile_importance",
      question: "Why should I complete my clinic profile?",
      questionAliases: [
        "Does a complete profile really make a difference?",
        "How important is profile completeness for inquiries?",
        "Should we fill all clinic profile details?",
      ],
      shortAnswer:
        "A complete profile builds trust and encourages more patients to contact your clinic.",
      detailedAnswer:
        "Patients compare clinics quickly. If your profile answers common questions, people feel safer contacting you. Complete details can improve inquiry quality because patients already understand your clinic before they message.",
      language: "en",
      priority: 74,
      sortOrder: 25,
      tags: ["complete_profile", "patient_trust", "better_inquiries", "clinic_info"],
    },
    {
      id: "playbook.en.026",
      section: "clinic_profile_marketplace",
      intent: "profile_content_impact",
      question:
        "How do reviews, social media links, doctors, and photos help?",
      questionAliases: [
        "Do profile details like photos and doctor info increase trust?",
        "Why should we add reviews and social links?",
        "How does rich profile content help patient decisions?",
      ],
      shortAnswer:
        "These details help patients trust your clinic and contact you faster.",
      detailedAnswer:
        "Reviews, photos, and doctor information reduce patient hesitation. People feel more confident when they can see your clinic clearly before sending a message. Higher trust usually means more conversations and better appointment intent.",
      language: "en",
      priority: 73,
      sortOrder: 26,
      tags: ["reviews", "doctor_info", "photos", "trust_signals"],
    },
    {
      id: "playbook.en.027",
      section: "clinic_profile_marketplace",
      intent: "marketplace_competitive_edge",
      question: "How does a Clinifly profile help us compete with other clinics?",
      questionAliases: [
        "Can Clinifly profile quality improve competitiveness?",
        "How do we stand out in a crowded dental market?",
        "Will a better profile help us win patient attention?",
      ],
      shortAnswer:
        "A stronger profile helps your clinic stand out and get more patient messages.",
      detailedAnswer:
        "When patients compare options, they usually choose the clinic that looks clear, responsive, and trustworthy. Clinifly helps present your clinic in a simple and convincing way. Better first impression can lead to more direct inquiries.",
      language: "en",
      priority: 72,
      sortOrder: 27,
      tags: ["competition", "stand_out", "profile_quality", "patient_attention"],
    },
    {
      id: "playbook.en.028",
      section: "clinic_profile_marketplace",
      intent: "profile_update_frequency",
      question: "How often should we update our clinic profile?",
      questionAliases: [
        "Should we refresh photos and clinic info regularly?",
        "Does profile freshness affect patient interest?",
        "When should we revise our listing content?",
      ],
      shortAnswer:
        "Update your profile regularly so patients always see current and accurate information.",
      detailedAnswer:
        "Old information can reduce trust and create confusion. Regular updates to photos, team details, and services show that your clinic is active. Fresh information helps patients decide faster and message with confidence.",
      language: "en",
      priority: 71,
      sortOrder: 28,
      tags: ["profile_updates", "accuracy", "fresh_content", "patient_confidence"],
    },
    {
      id: "playbook.en.029",
      section: "clinic_profile_marketplace",
      intent: "marketplace_visibility_growth",
      question: "Can Clinifly marketplace presence increase our inquiry volume?",
      questionAliases: [
        "Will being visible in Clinifly bring more patient interest?",
        "Does marketplace placement help generate inquiries?",
        "Can profile visibility improve inquiry flow?",
      ],
      shortAnswer:
        "It can increase inquiry volume by helping more patients discover and contact your clinic.",
      detailedAnswer:
        "Results depend on your market and clinic offer, but better visibility usually creates more chances for patient contact. Clinifly helps turn profile views into real messages by making communication easy. The focus is always more inquiries and more appointments.",
      language: "en",
      priority: 70,
      sortOrder: 29,
      tags: ["marketplace_visibility", "inquiry_volume", "patient_interest", "appointments"],
    },
    {
      id: "playbook.en.030",
      section: "clinic_profile_marketplace",
      intent: "profile_to_conversation_path",
      question: "How does Clinifly connect profile visitors to real conversations?",
      questionAliases: [
        "How do patients move from profile view to contact?",
        "Can profile traffic convert into chat inquiries?",
        "Does Clinifly shorten the path to contact?",
      ],
      shortAnswer:
        "Clinifly makes it easy for profile visitors to start a chat immediately.",
      detailedAnswer:
        "Patients often drop off when contact takes too many steps. Clinifly reduces that delay by linking clinic discovery to instant messaging options. This helps more interested visitors become active inquiries.",
      language: "en",
      priority: 69,
      sortOrder: 30,
      tags: ["profile_to_chat", "easy_contact", "fewer_dropoffs", "inquiry_conversion"],
    },
    {
      id: "playbook.en.031",
      section: "referral_system",
      intent: "referral_system_overview",
      question: "How does the referral system work?",
      questionAliases: [
        "How does Clinifly referral flow operate?",
        "Can patients invite others through Clinifly?",
        "How are referrals tracked for clinics?",
      ],
      shortAnswer:
        "Clinifly helps your clinic turn happy patients into new patient inquiries through referrals.",
      detailedAnswer:
        "Referrals are one of the strongest trust sources for clinics. Clinifly helps make referral activity clearer and easier to follow, so your team can respond quickly. This can bring steady new inquiries from patient recommendations.",
      language: "en",
      priority: 68,
      sortOrder: 31,
      tags: ["referrals", "happy_patients", "new_inquiries", "trust"],
    },
    {
      id: "playbook.en.032",
      section: "referral_system",
      intent: "existing_patients_acquisition",
      question: "How can existing patients help attract new patients?",
      questionAliases: [
        "Can current patients drive clinic growth?",
        "How do we use patient satisfaction for referrals?",
        "How does Clinifly support patient recommendations?",
      ],
      shortAnswer:
        "Satisfied patients can recommend your clinic, and Clinifly helps you handle those referrals better.",
      detailedAnswer:
        "People trust recommendations from friends and family. Clinifly helps your clinic keep referral conversations active and respond quickly. This helps convert referred inquiries into appointments with less delay.",
      language: "en",
      priority: 67,
      sortOrder: 32,
      tags: ["existing_patients", "recommendations", "referral_growth", "appointments"],
    },
    {
      id: "playbook.en.033",
      section: "referral_system",
      intent: "referral_conversion_quality",
      question: "Are referrals usually higher quality than cold leads?",
      questionAliases: [
        "Do referred patients convert better?",
        "Why are referrals valuable for dental clinics?",
        "Should we prioritize referral-driven growth?",
      ],
      shortAnswer:
        "Often yes, because referred patients usually come with higher trust from the start.",
      detailedAnswer:
        "Referral patients usually arrive warmer than unknown leads. Clinifly helps your team answer these inquiries quickly and move them toward booking. Fast follow-up is still important to convert trust into real appointments.",
      language: "en",
      priority: 66,
      sortOrder: 33,
      tags: ["referral_quality", "higher_trust", "faster_follow_up", "bookings"],
    },
    {
      id: "playbook.en.034",
      section: "referral_system",
      intent: "referral_tracking_visibility",
      question: "Can we track referral performance inside Clinifly?",
      questionAliases: [
        "How do we measure referrals with Clinifly?",
        "Can we see which referral activity brings results?",
        "Does Clinifly make referrals measurable?",
      ],
      shortAnswer:
        "Yes. Clinifly helps your team see referral activity more clearly.",
      detailedAnswer:
        "When referral activity is visible, your clinic can learn what is working and improve over time. Clinifly helps keep referral conversations easier to review so your team can make better decisions. This supports steady, repeatable referral growth.",
      language: "en",
      priority: 65,
      sortOrder: 34,
      tags: ["referral_tracking", "measurement", "better_decisions", "growth"],
    },
    {
      id: "playbook.en.035",
      section: "referral_system",
      intent: "referrals_with_other_channels",
      question: "Can referrals work together with our other patient acquisition channels?",
      questionAliases: [
        "Should referrals be combined with ads and social?",
        "Can Clinifly manage referrals and inbound inquiries together?",
        "Is referral growth part of a full acquisition strategy?",
      ],
      shortAnswer:
        "Yes. Referrals work best alongside WhatsApp, social media, and other ways patients find you.",
      detailedAnswer:
        "Strong clinics usually grow from more than one source. Clinifly helps your clinic answer referral and non-referral messages with the same fast replies. That means fewer missed conversations and more chances to book appointments.",
      language: "en",
      priority: 64,
      sortOrder: 35,
      tags: ["referrals_plus_ads", "balanced_growth", "inquiry_sources", "clinic_strategy"],
    },
    {
      id: "playbook.en.036",
      section: "pricing_membership",
      intent: "free_registration",
      question: "Is Clinifly free?",
      questionAliases: [
        "Can I register my clinic for free?",
        "Do we pay anything to start?",
        "Is there a free starting option for clinics?",
      ],
      shortAnswer:
        "Yes. Clinic registration is free, with a 2-month trial and no credit card required.",
      detailedAnswer:
        "You can sign up your clinic for free and test Clinifly for two months before paying. No credit card is needed to start the trial. This lets your team evaluate results in real patient conversations with low risk.",
      language: "en",
      priority: 63,
      sortOrder: 36,
      tags: ["free_registration", "two_month_trial", "no_credit_card", "low_risk_start"],
    },
    {
      id: "playbook.en.037",
      section: "pricing_membership",
      intent: "included_features",
      question: "What features are included?",
      questionAliases: [
        "What do clinics get with Clinifly?",
        "Which core tools are included?",
        "What is included in the clinic plan?",
      ],
      shortAnswer:
        "Clinifly helps clinics attract patients, answer inquiries quickly, and convert more inquiries into appointments.",
      detailedAnswer:
        "Core value includes patient discovery, direct messaging, AI assistant support, and team handover when needed. Clinifly also supports communication in more than 20 languages for international patients. The main goal is simple: more inquiries, faster replies, and more appointment conversions.",
      language: "en",
      priority: 62,
      sortOrder: 37,
      tags: ["included_features", "ai_assistant", "multi_language", "appointment_conversion"],
    },
    {
      id: "playbook.en.038",
      section: "pricing_membership",
      intent: "future_paid_plans",
      question: "Are there future paid plans?",
      questionAliases: [
        "Will Clinifly have paid tiers after trial?",
        "What are the plans after the free period?",
        "Is there a paid clinic plan after trial?",
      ],
      shortAnswer:
        "Yes. After trial, clinics can continue with paid plans like Pro and Premium.",
      detailedAnswer:
        "Clinics start free, test for two months, then choose the plan that fits their needs. This gives teams time to see real value before paying. It is a simple path from trial to paid use.",
      language: "en",
      priority: 61,
      sortOrder: 38,
      tags: ["paid_plans", "pro_plan", "premium_plan", "post_trial"],
    },
    {
      id: "playbook.en.039",
      section: "pricing_membership",
      intent: "trial_details",
      question: "How long is the trial, and do I need a card?",
      questionAliases: [
        "Is the trial 2 months?",
        "Do clinics need credit card details for trial activation?",
        "Can we test Clinifly before paying?",
      ],
      shortAnswer:
        "The trial is 2 months, and you do not need a credit card.",
      detailedAnswer:
        "Your clinic can use Clinifly for two full months to test response speed, staff workload impact, and appointment conversion results. No card is required to begin. This keeps your decision simple and low risk.",
      language: "en",
      priority: 60,
      sortOrder: 39,
      tags: ["trial_length", "no_card_needed", "test_before_pay", "clinic_trial"],
    },
    {
      id: "playbook.en.040",
      section: "pricing_membership",
      intent: "pro_plan_price",
      question: "What is the Pro plan price?",
      questionAliases: [
        "How much is Clinifly Pro per month?",
        "Is Pro $29 monthly?",
        "What does the entry paid plan cost?",
      ],
      shortAnswer: "Clinifly Pro is $29 per month (USD).",
      detailedAnswer:
        "After the trial, clinics can choose Pro for $29/month USD. It is a simple next step for teams that want to continue using Clinifly to handle inquiries and improve appointment conversion.",
      language: "en",
      priority: 59,
      sortOrder: 40,
      tags: ["pro_price", "29_usd", "monthly_plan", "pricing"],
    },
    {
      id: "playbook.en.041",
      section: "pricing_membership",
      intent: "premium_plan_price",
      question: "What is the Premium plan price?",
      questionAliases: [
        "How much is Clinifly Premium monthly?",
        "Is Premium $89 per month?",
        "What does the higher plan cost?",
      ],
      shortAnswer: "Clinifly Premium is $89 per month (USD).",
      detailedAnswer:
        "Clinics that need more capacity can choose Premium for $89/month USD after trial. This gives a clear upgrade path as your inquiry volume and team needs grow.",
      language: "en",
      priority: 58,
      sortOrder: 41,
      tags: ["premium_price", "89_usd", "upgrade_plan", "pricing"],
    },
    {
      id: "playbook.en.042",
      section: "pricing_membership",
      intent: "patient_app_cost",
      question: "Are patient apps free?",
      questionAliases: [
        "Do patients pay to use Clinifly app?",
        "Is the patient mobile app free to download?",
        "Are patient-facing apps included at no cost?",
      ],
      shortAnswer:
        "Yes. Patient apps are free, while clinics use trial and paid plans.",
      detailedAnswer:
        "Patients can use the app without paying, which makes it easier for them to communicate with clinics. Clinics follow the free registration plus trial and paid plan structure. This supports easier patient adoption and clear clinic pricing.",
      language: "en",
      priority: 57,
      sortOrder: 42,
      tags: ["patient_apps_free", "clinic_plans", "clear_pricing", "adoption"],
    },
    {
      id: "playbook.en.043",
      section: "objection_handling",
      intent: "already_use_whatsapp",
      question: "I already use WhatsApp.",
      questionAliases: [
        "We already chat with patients on WhatsApp, why Clinifly?",
        "If WhatsApp works, what extra value does Clinifly add?",
        "Do we need Clinifly if we already use WhatsApp daily?",
      ],
      shortAnswer:
        "WhatsApp gives messages; Clinifly helps you answer faster and turn more of those messages into appointments.",
      detailedAnswer:
        "Using WhatsApp is good, but many clinics still lose inquiries because replies are delayed or inconsistent. Clinifly AI can answer 24/7, keep chats active, and let your team take over anytime. This helps reduce missed opportunities without changing patient behavior.",
      language: "en",
      priority: 56,
      sortOrder: 43,
      tags: ["objection", "whatsapp", "faster_replies", "more_appointments"],
    },
    {
      id: "playbook.en.044",
      section: "objection_handling",
      intent: "already_use_instagram",
      question: "I already have Instagram.",
      questionAliases: [
        "We already market on Instagram, do we still need Clinifly?",
        "If we get DMs from Instagram, what does Clinifly add?",
        "Can Clinifly improve inquiry handling from social media?",
      ],
      shortAnswer:
        "Instagram can create interest; Clinifly helps convert that interest into appointments.",
      detailedAnswer:
        "Social media can bring patient messages, but booking depends on fast and clear follow-up. Clinifly helps continue those conversations right away, including after hours. This improves your chance of turning DMs into confirmed visits.",
      language: "en",
      priority: 55,
      sortOrder: 44,
      tags: ["objection", "instagram", "social_messages", "appointment_conversion"],
    },
    {
      id: "playbook.en.045",
      section: "objection_handling",
      intent: "already_get_google_patients",
      question: "I already get patients from Google.",
      questionAliases: [
        "If Google already works for us, why use Clinifly?",
        "Do we need Clinifly when search brings inquiries?",
        "Can Clinifly improve conversion of existing Google inquiries?",
      ],
      shortAnswer:
        "Clinifly helps you get more value from Google inquiries by improving reply speed and follow-up.",
      detailedAnswer:
        "Google can bring inquiries, but clinics still need to answer quickly to win appointments. Clinifly helps your team and AI assistant keep those conversations active from first message to booking. The goal is better conversion from demand you already have.",
      language: "en",
      priority: 54,
      sortOrder: 45,
      tags: ["objection", "google_inquiries", "reply_speed", "booking_rate"],
    },
    {
      id: "playbook.en.046",
      section: "objection_handling",
      intent: "patient_count_expectation",
      question: "How many patients will Clinifly bring me?",
      questionAliases: [
        "Can you guarantee a specific number of new patients?",
        "How many inquiries per month will we receive?",
        "What exact patient volume can Clinifly promise?",
      ],
      shortAnswer:
        "We do not guarantee patient numbers; results depend on your clinic, market, and follow-up quality.",
      detailedAnswer:
        "It is not honest to promise exact patient numbers. Clinifly helps improve important drivers such as faster replies, better communication, and stronger inquiry-to-appointment conversion. Final results vary by each clinic's offer, pricing, team, and market conditions.",
      language: "en",
      priority: 88,
      sortOrder: 46,
      tags: ["objection", "no_guarantees", "realistic_expectations", "patient_count"],
    },
    {
      id: "playbook.en.047",
      section: "objection_handling",
      intent: "revenue_guarantee_concern",
      question: "Do you guarantee revenue growth?",
      questionAliases: [
        "Will Clinifly guarantee income increase for our clinic?",
        "Can you promise a return on investment?",
        "Is revenue growth guaranteed with Clinifly?",
      ],
      shortAnswer:
        "No. We do not guarantee revenue, but we help improve communication that supports better booking outcomes.",
      detailedAnswer:
        "Revenue depends on many factors beyond software, such as treatment pricing, close rates, and market demand. Clinifly focuses on what we can improve responsibly: more inquiries, faster responses, and better conversion to appointments. This supports growth potential without unrealistic promises.",
      language: "en",
      priority: 87,
      sortOrder: 47,
      tags: ["objection", "revenue_question", "no_revenue_promise", "better_bookings"],
    },
    {
      id: "playbook.en.048",
      section: "objection_handling",
      intent: "platform_fatigue",
      question: "Why should I join another platform if my clinic is already busy?",
      questionAliases: [
        "We are overloaded already, why add Clinifly now?",
        "Will another tool create extra work?",
        "Is Clinifly worth it when team capacity is limited?",
      ],
      shortAnswer:
        "Clinifly is made to reduce repetitive message work, not add more work for your staff.",
      detailedAnswer:
        "Busy clinics often need faster first replies the most. Clinifly AI can answer common questions and keep chats active while your team handles key cases. This reduces daily pressure and helps your staff focus on appointment-ready patients.",
      language: "en",
      priority: 51,
      sortOrder: 48,
      tags: ["objection", "busy_team", "less_repetitive_work", "ai_help"],
    },
    {
      id: "playbook.en.049",
      section: "objection_handling",
      intent: "skepticism_about_new_tools",
      question: "How is Clinifly not just another marketing tool?",
      questionAliases: [
        "Is Clinifly more than simple advertising software?",
        "What makes Clinifly useful for clinics day to day?",
        "Why is Clinifly different from generic marketing tools?",
      ],
      shortAnswer:
        "Clinifly is not only for visibility; it helps your clinic turn inquiries into appointments with faster communication.",
      detailedAnswer:
        "Many tools help clinics get attention, but they stop there. Clinifly also helps with what happens next: answering patient questions, requesting photos, sharing treatment information, and continuing chats 24/7. That is why it supports real appointment conversion, not just impressions.",
      language: "en",
      priority: 50,
      sortOrder: 49,
      tags: ["objection", "beyond_marketing", "inquiry_to_appointment", "real_use"],
    },
    {
      id: "playbook.en.050",
      section: "objection_handling",
      intent: "final_join_decision",
      question: "What is the safest way to decide if Clinifly is right for us?",
      questionAliases: [
        "How can we evaluate Clinifly with low risk?",
        "What is the best way to test Clinifly before paying?",
        "How should a clinic make a smart join decision?",
      ],
      shortAnswer:
        "Register free, use the 2-month no-card trial, and decide based on your real inquiry and appointment results.",
      detailedAnswer:
        "The safest approach is to test Clinifly in your daily clinic routine. Track response speed, staff time saved, and how many inquiries move toward appointment booking. With free registration and a two-month trial, you can decide with real data and low risk.",
      language: "en",
      priority: 49,
      sortOrder: 50,
      tags: ["decision", "free_trial", "low_risk", "measure_results"],
    },
  ];
}

module.exports = { getPartnerClinicPlaybookData };
