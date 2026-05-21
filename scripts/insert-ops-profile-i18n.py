#!/usr/bin/env python3
"""Insert opsProfile i18n blocks into admin-i18n.js (run once)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
I18N = ROOT / "public" / "admin-i18n.js"

BLOCKS = {
    "tr": '''
      opsProfile: {
        pageTitle: "Klinik Operasyon Profili — Clinifly Admin",
        title: "Klinik Operasyon Profili",
        lead: "Yapay zeka yanıtları, teklifler, seyahat koordinasyonu, SLA otomasyonu ve koordinatör iş akışları için tek kaynak.",
        backSettings: "← Hesap ayarları",
        counts: "Oteller: {hotels} · İş akışı protokolleri: {protocols}",
        loading: "Yükleniyor…",
        loadMetaFailed: "Meta verisi yüklenemedi",
        loadFailed: "Yükleme başarısız",
        saveSection: "Bölümü kaydet",
        saving: "Kaydediliyor…",
        saved: "Kaydedildi",
        failed: "Başarısız",
        saveFailed: "Kaydetme başarısız",
        refresh: "Yenile",
        openJourneys: "Yolculukları aç",
        openHotelManager: "Otel yöneticisini aç →",
        priceListLink: "→ Tedavi fiyat listesi",
        priceListHint: "(operasyonel + yapay zeka fiyatlandırması)",
        multilingualNoteTitle: "Tek klinik bilgisi, birçok dil.",
        multilingualNoteBody: "Aşağıdan dilleri etkinleştirin. Markalar, fiyatlar, lojistik ve iş akışı tek yapılandırmada kalır — yapay zeka her dilde doğal yanıt verir, operasyonel kurulumu tekrarlamanız gerekmez.",
        langFuture: "(yakında)",
        langColLanguage: "Dil",
        langColAi: "YZ etkin",
        langColPrimary: "Birincil",
        langColHuman: "İnsan personel",
        localizedPlaceholder: "İsteğe bağlı — boş bırakılırsa YZ çevirir",
        hotelsCount: "{count} otel",
        transferIncluded: "transfer dahil",
        perNight: "/gece",
        sections: {
          aiProfile: { title: "Klinik YZ Profili", hint: "Çok dilli YZ orkestrasyonu — tek bilgi kaynağı; operasyonel veriler yanıt sırasında yerelleştirilir." },
          materials: { title: "İmplant Markaları ve Malzemeler", hint: "Markalar, laboratuvarlar, garanti — açıklayıcı YZ yanıtları için." },
          travel: { title: "Seyahat ve Konaklama", hint: "Diş turizmi koordinasyonu için partner oteller." },
          logistics: { title: "Klinik Lojistiği", hint: "Çalışma saatleri, SLA, acil iletişim, aynı gün tedavi." },
          payment: { title: "Ödeme ve Mali Politikalar", hint: "Depozito, taksit, iade — YZ politika metnini kullanır, garanti vermez." },
          workflow: { title: "Tedavi İş Akışı Bilgisi", hint: "Ziyaret süreleri, iyileşme — operasyonel, klinik tanı değil." },
          aiSafety: { title: "YZ Güvenliği ve İnsan İncelemesi", hint: "Kategori bazlı özerklik; fiyatlandırma en fazla SUGGEST_ONLY." },
          handoff: { title: "İnsana Devir Kuralları", hint: "Bu tetikleyicilerde YZ koordinatöre veya doktora yönlendirir." },
          internalNotes: { title: "Dahili YZ Bilgi Notları", hint: "Klinik konumlandırma — hastaya aynen gösterilmez." }
        },
        sedationAvailable: "Sedasyon mevcut",
        weekendAvailability: "Hafta sonu müsaitlik",
        sameDayTreatment: "Aynı gün tedavi",
        airportTransfer: "Havalimanı transferi",
        depositRequired: "Depozito gerekli",
        installments: "Taksit",
        financing: "Finansman",
        autonomyIntro: "Yapay zekanın ne kadar bağımsız yanıt verebileceğini seçin. Tıbbi konular her zaman insan gerektirir.",
        autonomyCategory: "Kategori",
        autonomyLevel: "Seviye",
        safetyIntro: "Her zaman insan incelemesi gerekir (tıbbi tavsiye asla otomatik gönderilmez):",
        handoffIntro: "İşaretlendiğinde YZ otomatik yanıtı durdurur ve ekibinizi uyarır.",
        workflowJourneysHint: "Tedavi yolculuklarında iyileşme, operasyon sonrası ve YZ notlarını yapılandırın.",
        postOpExample: "Örnek alan — Operasyon sonrası koordinasyon notları:",
        autonomy: {
          greetings: "Karşılamalar",
          logistics: "Lojistik ve seyahat koordinasyonu",
          pricing_explanations: "Fiyat açıklamaları",
          appointment_coordination: "Randevu koordinasyonu",
          treatment_process_explanations: "Tedavi süreci açıklamaları",
          post_op_guidance: "Operasyon sonrası rehberlik"
        },
        handoff: {
          angryPatient: "Kızgın hasta",
          refundRequest: "İade talebi",
          severePain: "Şiddetli ağrı",
          legalLanguage: "Hukuki dil",
          emergencyWording: "Acil durum ifadesi"
        },
        safety: {
          diagnosis: "Tanı",
          surgeryDecisions: "Cerrahi kararlar",
          medicationAdvice: "İlaç tavsiyesi",
          emergencies: "Acil durumlar",
          complications: "Komplikasyonlar"
        },
        langs: { en: "İngilizce", tr: "Türkçe", ru: "Rusça", ka: "Gürcüce", ar: "Arapça", de: "Almanca", fr: "Fransızca" }
      },
''',
    "en": '''
      opsProfile: {
        pageTitle: "Clinic Operations Profile — Clinifly Admin",
        title: "Clinic Operations Profile",
        lead: "Source of truth for AI responses, offers, travel coordination, SLA automation, and coordinator workflows.",
        backSettings: "← Account settings",
        counts: "Hotels: {hotels} · Workflow protocols: {protocols}",
        loading: "Loading…",
        loadMetaFailed: "Failed to load meta",
        loadFailed: "Load failed",
        saveSection: "Save section",
        saving: "Saving…",
        saved: "Saved",
        failed: "Failed",
        saveFailed: "Save failed",
        refresh: "Refresh",
        openJourneys: "Open journeys",
        openHotelManager: "Open full hotel manager →",
        priceListLink: "→ Treatment Price List",
        priceListHint: "(operational + AI pricing)",
        multilingualNoteTitle: "One clinic knowledge, many languages.",
        multilingualNoteBody: "Enable languages below. Brands, pricing, logistics, and workflow stay in one structured source — the AI responds naturally without duplicating operational setup per language.",
        langFuture: "(future)",
        langColLanguage: "Language",
        langColAi: "AI enabled",
        langColPrimary: "Primary",
        langColHuman: "Human staff",
        localizedPlaceholder: "Optional — AI can localize if empty",
        hotelsCount: "{count} hotels",
        transferIncluded: "transfer included",
        perNight: "/night",
        sections: {
          aiProfile: { title: "Clinic AI Profile", hint: "Multilingual AI orchestration — one knowledge source; AI localizes ops data at reply time." },
          materials: { title: "Implant Brands & Materials", hint: "Brands, labs, warranty — for explanatory AI replies." },
          travel: { title: "Travel & Accommodation", hint: "Partner hotels for dental tourism coordination." },
          logistics: { title: "Clinic Logistics", hint: "Hours, SLA, emergency contact, same-day treatment." },
          payment: { title: "Payment & Financial Policies", hint: "Deposits, financing, refunds — AI uses policy text, not guarantees." },
          workflow: { title: "Treatment Workflow Knowledge", hint: "Visit timelines, healing — operational not clinical diagnosis." },
          aiSafety: { title: "AI Safety & Human Review", hint: "Autonomy per category; pricing capped at SUGGEST_ONLY." },
          handoff: { title: "Human Handoff Rules", hint: "When AI escalates to coordinator or doctor." },
          internalNotes: { title: "Internal AI Knowledge Notes", hint: "Clinic positioning — not shown verbatim to patients." }
        },
        sedationAvailable: "Sedation available",
        weekendAvailability: "Weekend availability",
        sameDayTreatment: "Same-day treatment",
        airportTransfer: "Airport transfer",
        depositRequired: "Deposit required",
        installments: "Installments",
        financing: "Financing",
        autonomyIntro: "Choose how independently the AI may respond. Medical topics always require a human.",
        autonomyCategory: "Category",
        autonomyLevel: "Level",
        safetyIntro: "Always require human review (never auto-sent for medical advice):",
        handoffIntro: "When checked, the AI stops auto-replying and alerts your team.",
        workflowJourneysHint: "Configure per-treatment healing, post-op, and AI notes in Treatment Journeys.",
        postOpExample: "Example field — Post-op coordination notes:",
        autonomy: {
          greetings: "Greetings",
          logistics: "Logistics & travel coordination",
          pricing_explanations: "Pricing explanations",
          appointment_coordination: "Appointment coordination",
          treatment_process_explanations: "Treatment process explanations",
          post_op_guidance: "Post-op guidance"
        },
        handoff: {
          angryPatient: "Angry patient",
          refundRequest: "Refund request",
          severePain: "Severe pain",
          legalLanguage: "Legal language",
          emergencyWording: "Emergency wording"
        },
        safety: {
          diagnosis: "Diagnosis",
          surgeryDecisions: "Surgery decisions",
          medicationAdvice: "Medication advice",
          emergencies: "Emergencies",
          complications: "Complications"
        },
        langs: { en: "English", tr: "Turkish", ru: "Russian", ka: "Georgian", ar: "Arabic", de: "German", fr: "French" }
      },
''',
    "ru": '''
      opsProfile: {
        pageTitle: "Профиль операций клиники — Clinifly Admin",
        title: "Профиль операций клиники",
        lead: "Единый источник для ответов ИИ, предложений, travel-координации, SLA и рабочих процессов координатора.",
        backSettings: "← Настройки аккаунта",
        counts: "Отели: {hotels} · Протоколы workflow: {protocols}",
        loading: "Загрузка…",
        loadMetaFailed: "Не удалось загрузить meta",
        loadFailed: "Ошибка загрузки",
        saveSection: "Сохранить раздел",
        saving: "Сохранение…",
        saved: "Сохранено",
        failed: "Ошибка",
        saveFailed: "Ошибка сохранения",
        refresh: "Обновить",
        openJourneys: "Открыть journeys",
        openHotelManager: "Открыть менеджер отелей →",
        priceListLink: "→ Прайс-лист лечения",
        priceListHint: "(операционные + ИИ цены)",
        multilingualNoteTitle: "Одна база знаний клиники — много языков.",
        multilingualNoteBody: "Включите языки ниже. Бренды, цены, логистика и workflow остаются в одном источнике — ИИ отвечает естественно без дублирования настроек на каждый язык.",
        langFuture: "(скоро)",
        langColLanguage: "Язык",
        langColAi: "ИИ включён",
        langColPrimary: "Основной",
        langColHuman: "Персонал",
        localizedPlaceholder: "Необязательно — ИИ переведёт, если пусто",
        hotelsCount: "{count} отелей",
        transferIncluded: "трансфер включён",
        perNight: "/ночь",
        sections: {
          aiProfile: { title: "Профиль ИИ клиники", hint: "Многоязычная оркестрация ИИ — один источник знаний." },
          materials: { title: "Бренды имплантов и материалы", hint: "Бренды, лаборатории, гарантия." },
          travel: { title: "Путешествие и проживание", hint: "Партнёрские отели для dental tourism." },
          logistics: { title: "Логистика клиники", hint: "Часы работы, SLA, экстренный контакт." },
          payment: { title: "Оплата и финансовая политика", hint: "Депозиты, рассрочка, возвраты." },
          workflow: { title: "Знания о workflow лечения", hint: "Визиты, заживление — операционно, не диагноз." },
          aiSafety: { title: "Безопасность ИИ и проверка человеком", hint: "Автономия по категориям." },
          handoff: { title: "Правила передачи человеку", hint: "Когда ИИ эскалирует координатору или врачу." },
          internalNotes: { title: "Внутренние заметки для ИИ", hint: "Позиционирование клиники." }
        },
        sedationAvailable: "Седация доступна",
        weekendAvailability: "Работа в выходные",
        sameDayTreatment: "Лечение в тот же день",
        airportTransfer: "Трансфер из аэропорта",
        depositRequired: "Требуется депозит",
        installments: "Рассрочка",
        financing: "Финансирование",
        autonomyIntro: "Выберите, насколько независимо ИИ может отвечать. Медицинские темы всегда требуют человека.",
        autonomyCategory: "Категория",
        autonomyLevel: "Уровень",
        safetyIntro: "Всегда требуется проверка человеком:",
        handoffIntro: "При отметке ИИ прекращает автоответ и предупреждает команду.",
        workflowJourneysHint: "Настройте healing, post-op и заметки ИИ в Treatment Journeys.",
        postOpExample: "Пример поля — Post-op заметки:",
        autonomy: {
          greetings: "Приветствия",
          logistics: "Логистика и travel",
          pricing_explanations: "Объяснение цен",
          appointment_coordination: "Координация записи",
          treatment_process_explanations: "Объяснение процесса лечения",
          post_op_guidance: "Послеоперационные рекомендации"
        },
        handoff: {
          angryPatient: "Злой пациент",
          refundRequest: "Запрос возврата",
          severePain: "Сильная боль",
          legalLanguage: "Юридические формулировки",
          emergencyWording: "Слова об экстренной ситуации"
        },
        safety: {
          diagnosis: "Диагноз",
          surgeryDecisions: "Хирургические решения",
          medicationAdvice: "Советы по лекарствам",
          emergencies: "Экстренные случаи",
          complications: "Осложнения"
        },
        langs: { en: "Английский", tr: "Турецкий", ru: "Русский", ka: "Грузинский", ar: "Арабский", de: "Немецкий", fr: "Французский" }
      },
''',
    "ka": '''
      opsProfile: {
        pageTitle: "კლინიკის ოპერაციების პროფილი — Clinifly Admin",
        title: "კლინიკის ოპერაციების პროფილი",
        lead: "ერთი წყარო AI პასუხების, შეთავაზებების, მოგზაურობის, SLA და კოორდინატორის workflow-ისთვის.",
        backSettings: "← ანგარიშის პარამეტრები",
        counts: "სასტუმროები: {hotels} · workflow პროტოკოლები: {protocols}",
        loading: "იტვირთება…",
        loadMetaFailed: "meta ვერ ჩაიტვირთა",
        loadFailed: "ჩატვირთვა ვერ მოხერხდა",
        saveSection: "განყოფილების შენახვა",
        saving: "ინახება…",
        saved: "შენახულია",
        failed: "შეცდომა",
        saveFailed: "შენახვა ვერ მოხერხდა",
        refresh: "განახლება",
        openJourneys: "გახსნა journeys",
        openHotelManager: "სასტუმროს მენეჯერი →",
        priceListLink: "→ მკურნალობის ფასების სია",
        priceListHint: "(ოპერაციული + AI ფასები)",
        multilingualNoteTitle: "ერთი კლინიკის ცოდნა, მრავალი ენა.",
        multilingualNoteBody: "ჩართეთ ენები ქვემოთ. ბრენდები, ფასები და workflow რჩება ერთ წყაროში — AI ბუნებრივად პასუხობს ყოველ ენაზე.",
        langFuture: "(მომავალში)",
        langColLanguage: "ენა",
        langColAi: "AI ჩართული",
        langColPrimary: "ძირითადი",
        langColHuman: "პერსონალი",
        localizedPlaceholder: "არასავალდებულო — ცარიელი დატოვეთ AI-ს თარგმნისთვის",
        hotelsCount: "{count} სასტუმრო",
        transferIncluded: "ტრანსფერი ჩართული",
        perNight: "/ღამე",
        sections: {
          aiProfile: { title: "კლინიკის AI პროფილი", hint: "მრავალენოვანი AI ორკესტრაცია." },
          materials: { title: "იმპლანტის ბრენდები და მასალები", hint: "ბრენდები, ლაბორატორიები, გარანტია." },
          travel: { title: "მოგზაურობა და საცხოვრებელი", hint: "პარტნიორი სასტუმროები." },
          logistics: { title: "კლინიკის ლოჯისტიკა", hint: "საათები, SLA, გადაუდებელი კონტაქტი." },
          payment: { title: "გადახდა და ფინანსური პოლიტიკა", hint: "დეპოზიტი, განვადება, დაბრუნება." },
          workflow: { title: "მკურნალობის workflow ცოდნა", hint: "ვიზიტები, განკურნება." },
          aiSafety: { title: "AI უსაფრთხოება და ადამიანის შემოწმება", hint: "ავტონომია კატეგორიებით." },
          handoff: { title: "ადამიანზე გადაცემის წესები", hint: "როდის AI ესკალირებს." },
          internalNotes: { title: "შიდა AI შენიშვნები", hint: "კლინიკის პოზიციონირება." }
        },
        sedationAvailable: "სედაცია ხელმისაწვდომია",
        weekendAvailability: "შაბათ-კვირა",
        sameDayTreatment: "იმავე დღეს მკურნალობა",
        airportTransfer: "აეროპორტის ტრანსფერი",
        depositRequired: "საჭიროა დეპოზიტი",
        installments: "განვადება",
        financing: "დაფინანსება",
        autonomyIntro: "აირჩიეთ AI-ის დამოუკიდებლობა. სამედიცინო თემები ყოველთვის საჭიროებს ადამიანს.",
        autonomyCategory: "კატეგორია",
        autonomyLevel: "დონე",
        safetyIntro: "ყოველთვის საჭიროა ადამიანის შემოწმება:",
        handoffIntro: "მონიშვნისას AI წყვეტს ავტოპასუხს და გაფრთხილებს გუნდს.",
        workflowJourneysHint: "დააყენეთ healing და AI შენიშვნები Treatment Journeys-ში.",
        postOpExample: "მაგალითი — Post-op შენიშვნები:",
        autonomy: {
          greetings: "მისალმებები",
          logistics: "ლოჯისტიკა და მოგზაურობა",
          pricing_explanations: "ფასების ახსნა",
          appointment_coordination: "ჩაწერის კოორდინაცია",
          treatment_process_explanations: "მკურნალობის პროცესის ახსნა",
          post_op_guidance: "ოპერაციის შემდგომი მითითებები"
        },
        handoff: {
          angryPatient: "გაბრიტებული პაციენტი",
          refundRequest: "დაბრუნების მოთხოვნა",
          severePain: "მძიმე ტკივილი",
          legalLanguage: "იურიდიული ენა",
          emergencyWording: "საგანგებო სიტყვები"
        },
        safety: {
          diagnosis: "დიაგნოზი",
          surgeryDecisions: "ქირურგიული გადაწყვეტილებები",
          medicationAdvice: "მედიკამენტების რჩევა",
          emergencies: "გადაუდებელი შემთხვევები",
          complications: "გართულებები"
        },
        langs: { en: "ინგლისური", tr: "თურქული", ru: "რუსული", ka: "ქართული", ar: "არაბული", de: "გერმანული", fr: "ფრანგული" }
      },
''',
}

SETTINGS_CARD = {
    "tr": '''
        opsProfileCardTitle: "Klinik Operasyon Profili",
        opsProfileCardDesc: "Yapay zeka yanıtları, teklifler, seyahat koordinasyonu, SLA otomasyonu ve koordinatör iş akışları için operasyonel beyin. Yapılandırılmış klinik bilgisi — genel chatbot ayarları değil.",
        opsProfileCardPricing: "Fiyatlandırma ve marka varyantları aşağıdaki <strong>Tedavi Fiyat Listesi</strong>nde yapılandırılır (randevu + YZ için tek kaynak).",
        opsProfileOpen: "Operasyon Profilini Aç →",
''',
    "en": '''
        opsProfileCardTitle: "Clinic Operations Profile",
        opsProfileCardDesc: "Operational brain for AI responses, offers, travel coordination, SLA automation, and coordinator workflows. Structured clinic knowledge — not generic chatbot settings.",
        opsProfileCardPricing: "Pricing & brand variants are configured in the <strong>Treatment Price List</strong> below (one source for appointments + AI).",
        opsProfileOpen: "Open Operations Profile →",
''',
    "ru": '''
        opsProfileCardTitle: "Профиль операций клиники",
        opsProfileCardDesc: "Операционная база для ответов ИИ, предложений, travel и workflow координатора.",
        opsProfileCardPricing: "Цены и варианты брендов — в <strong>прайс-листе лечения</strong> ниже.",
        opsProfileOpen: "Открыть профиль операций →",
''',
    "ka": '''
        opsProfileCardTitle: "კლინიკის ოპერაციების პროფილი",
        opsProfileCardDesc: "ოპერაციული ცოდნა AI პასუხებისა და კოორდინატორის workflow-ისთვის.",
        opsProfileCardPricing: "ფასები და ბრენდის ვარიანტები — ქვემოთ <strong>ფასების სიაში</strong>.",
        opsProfileOpen: "ოპერაციების პროფილის გახსნა →",
''',
}

text = I18N.read_text(encoding="utf-8")
for lang, block in BLOCKS.items():
    marker = f'    {lang}: {{'
    if f"opsProfile:" in text.split(marker, 1)[1].split("\n    en:", 1)[0] if lang == "tr" else "":
        pass
    # insert opsProfile before patients in each lang block
    needle = f"        minutes: "
    # find per-lang: after settings minutes line
    import re
    pat = rf"({lang}: \{{[\s\S]*?settings: \{{[\s\S]*?minutes: [^\n]+\n      \}},)\n\n      // Patients"
    if re.search(pat, text):
        text = re.sub(pat, r"\1\n" + block + "\n      // Patients", text, count=1)
    else:
        print(f"WARN: could not insert opsProfile for {lang}")

for lang, card in SETTINGS_CARD.items():
    needle = f'        minutes: "'
    # insert card keys before closing settings in each lang - after minutes line in settings
    pat = rf"({lang}: \{{[\s\S]*?settings: \{{[\s\S]*?minutes: [^\n]+\n)(      \}},)"
    if "opsProfileCardTitle" not in text.split(f"{lang}:")[1].split("patients:")[0]:
        text = re.sub(pat, r"\1" + card + r"\2", text, count=1)

# rerender hook
if "window.rerenderOpsProfile" not in text:
    text = text.replace(
        "    if (typeof window.rerenderSettings === 'function') {",
        "    if (typeof window.rerenderOpsProfile === 'function') {\n      try { window.rerenderOpsProfile(); } catch (e) { console.warn('rerenderOpsProfile', e); }\n    }\n    if (typeof window.rerenderSettings === 'function') {",
        1,
    )

I18N.write_text(text, encoding="utf-8")
print("done, opsProfile keys:", text.count("opsProfile:"))
