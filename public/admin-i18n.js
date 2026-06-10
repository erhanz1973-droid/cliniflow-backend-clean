// Admin Panel i18n — use window.AdminI18n.* only for admin_lang. Dev: ?adminI18nDev=1 blocks rogue localStorage writes; ?adminI18nValidate=1 logs EN vs TR/RU/KA section parity.
(function() {
  'use strict';

  if (window.__cliniflowI18nModuleRan) {
    console.warn('⚠️ i18n already initialized, skipping duplicate load');
    return;
  }
  window.__cliniflowI18nModuleRan = true;
  console.log('I18N INIT RUN', Date.now());
  console.log('I18N FILE VERSION:', 'v52');

  // Reentrancy guard to prevent update recursion (stack overflow)
  let isUpdatingI18n = false;

  var ADMIN_LANG_ALLOWED = new Set(['tr', 'en', 'ru', 'ka']);
  var ADMIN_LANG_STORAGE_KEY = 'admin_lang';

  /** Normalize tags like en-US, EN, ru_RU → tr|en|ru|ka (never browser navigator — admin UI is explicit). */
  function normalizeAdminLang(raw) {
    var s = String(raw == null ? '' : raw).trim().toLowerCase().replace(/_/g, '-');
    if (!s) return 'en';
    var base = s.split('-')[0];
    return ADMIN_LANG_ALLOWED.has(base) ? base : 'en';
  }

  /** Single read path for persisted admin UI language (normalized). */
  function readAdminLangStorage() {
    try {
      return normalizeAdminLang(localStorage.getItem(ADMIN_LANG_STORAGE_KEY) || 'en');
    } catch (e) {
      return 'en';
    }
  }

  /** Only writeAdminLangStorage may set localStorage admin_lang (dev guard enforces this on localhost). */
  var _allowAdminLangWrite = false;

  /** Single write path for localStorage — use only from i18n.setLanguage / init canonicalization. */
  function writeAdminLangStorage(raw) {
    var norm = normalizeAdminLang(raw);
    try {
      _allowAdminLangWrite = true;
      localStorage.setItem(ADMIN_LANG_STORAGE_KEY, norm);
    } catch (e) {
      /* quota / private mode */
    } finally {
      _allowAdminLangWrite = false;
    }
    return norm;
  }

  /** localhost / ?adminI18nDev=1 — warn and ignore rogue writes to admin_lang */
  function installAdminLangStorageGuard() {
    try {
      var h = typeof location !== 'undefined' ? String(location.hostname || '') : '';
      var dev =
        h === 'localhost' ||
        h === '127.0.0.1' ||
        h === '::1' ||
        (typeof location !== 'undefined' && /[?&]adminI18nDev=1(?:&|$)/.test(location.search || ''));
      if (!dev || typeof localStorage === 'undefined') return;
      var orig = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function (key, val) {
        if (key === ADMIN_LANG_STORAGE_KEY && !_allowAdminLangWrite) {
          console.warn(
            '[AdminI18n] Ignored direct localStorage.setItem("' +
              ADMIN_LANG_STORAGE_KEY +
              '"). Use AdminI18n.setLanguage() or window.i18n.setLanguage().',
          );
          return;
        }
        return orig(key, val);
      };
    } catch (e) {
      /* ignore */
    }
  }

  installAdminLangStorageGuard();

  const DASHBOARD_SIDEBAR_I18N = {
    mainMenu: { en: 'Main Menu', tr: 'Ana Menü', ru: 'Главное меню', ka: 'მთავარი მენიუ' },
    management: { en: 'Management', tr: 'Yönetim', ru: 'Управление', ka: 'მართვა' },
    logout: { en: 'Logout', tr: 'Çıkış', ru: 'Выход', ka: 'გასვლა' },
    clinic: { en: 'Clinic', tr: 'Klinik', ru: 'Клиника', ka: 'კლინიკა' }
  };

  function validateTranslations(dict) {
    if (!dict || typeof dict !== 'object') return;
    Object.keys(dict).forEach((key) => {
      const entry = dict[key];
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        ['en', 'tr', 'ru', 'ka'].forEach((lang) => {
          if (entry[lang] == null || String(entry[lang]).trim() === '') {
            console.warn('Missing translation:', key, lang);
          }
        });
      }
    });
  }

  try {
    validateTranslations(DASHBOARD_SIDEBAR_I18N);
  } catch (e) {
    /* ignore */
  }

  function clearStaleNavTextNodes() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    try {
      document.querySelectorAll('*').forEach(function (el) {
        /* Never strip sidebar/nav — same strings are valid i18n labels on dark sidebar */
        if (el.closest && el.closest('.al-sidebar')) return;
        if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
          const txt = el.textContent.trim();
          if (txt === 'Main Menu' || txt === 'Takvim') {
            el.textContent = '';
          }
        }
      });
    } catch (e) { /* no-op */ }
  }

  const translations = {
    tr: {
      // Common
      common: {
        loading: "Yükleniyor...",
        save: "Kaydet",
        cancel: "İptal",
        delete: "Sil",
        edit: "Düzenle",
        search: "Ara",
        filter: "Filtrele",
        close: "Kapat",
        back: "Geri",
        next: "İleri",
        previous: "Önceki",
        submit: "Gönder",
        yes: "Evet",
        no: "Hayır",
        ok: "Tamam",
        error: "Hata",
        success: "Başarılı",
        warning: "Uyarı",
        doctor: "Doktor"
      },

      adminPages: {
        travelH1: "✈️ Clinifly Admin – Travel",
        travelGlobalWarning: "⚠️ UYARI: Kullanıcı tarafından doldurulacak alan(lar) var. Aşağıdaki uyarıları kontrol edin.",
        travelWordHotel: "Otel",
        travelWordFlights: "Uçuş",
        travelListSeparator: " ve ",
        travelDynamicWarning: "⚠️ UYARI: {list} bilgilerini kullanıcı dolduracak. Bu alanları değiştiremezsiniz. Kullanıcı mobil uygulamadan bu bilgileri girecek.",
        healthH1: "🩺 Clinifly Admin – Health",
        doctorApplicationsH1: "Doktor Başvuruları",
        doctorAppsStatPending: "Beklemede",
        doctorAppsStatApproved: "Onaylı",
        doctorAppsStatRejected: "Reddedildi",
        doctorAppsStatTotal: "Toplam",
        doctorAppsLoading: "Doktorlar yükleniyor...",
        doctorAppsEmptyTitle: "Henüz doktor bulunmuyor",
        doctorAppsEmptyDesc: "Doktor başvurusu henüz yapılmadı.",
        activePatientsH1: "👨‍⚕️ Aktif Kullanıcılar",
        activePatientsStatActive: "Aktif Kullanıcı",
        activePatientsStatPending: "Bekleyen Kullanıcı",
        activePatientsStatTotal: "Toplam Kullanıcı",
        activePatientsStatClinic: "Klinik Sayısı",
        activePatientsSearchPlaceholder: "Kullanıcı adı, email veya telefon ile ara...",
        activePatientsAllClinics: "Tüm Klinikler",
        activePatientsRefresh: "🔄 Yenile",
        activePatientsLoading: "🔄 Yükleniyor...",
        activePatientsEmpty: "Henüz aktif kullanıcı bulunmuyor",
        treatmentCreateH1: "🏥 Treatment Oluştur",
        treatmentCreateSubtitle: "Yeni tedavi grubu oluşturun ve doktor atayın",
        patientDetailH1: "Kullanıcı Detay",
        patientDetailBack: "Geri",
        legacyNavClinics: "Klinikler"
      },
      
      // Suspended Clinic Messages
      clinicSuspended: {
        title: "Hesabınız Geçici Olarak Askıya Alındı",
        description: "Klinik hesabınız şu anda aktif değildir. Bu süre boyunca dashboard ve kullanıcı işlemlerine erişim kısıtlanmıştır.",
        reasonTitle: "Askıya Alma Nedeni",
        reasonGeneric: "Hesabınız sistem ve güvenlik kontrolleri kapsamında incelenmektedir.",
        whatToDoTitle: "Nasıl Tekrar Aktif Olur?",
        steps: [
          "Destek ekibimiz hesabınızı inceliyor",
          "Gerekli olması halinde sizinle iletişime geçilecektir",
          "Sorularınız için bizimle iletişime geçebilirsiniz"
        ],
        contactSupport: "Destek ile İletişime Geç",
        learnMore: "Daha Fazla Bilgi",
        statusBadge: "Durum: Askıda"
      },
      
      // Dashboard (admin.html)
      dashboard: {
        title: "Clinifly Admin – Dashboard",
        sidebar: {
          mainMenu: "Ana Menü",
          management: "Yönetim",
          logout: "Çıkış",
          clinic: "Klinik"
        },
        nav: {
          dashboard: "Dashboard",
          patients: "Kullanıcılar",
          invitePatients: "Kullanıcı Daveti",
          travel: "Seyahat",
          treatment: "Tedaviler",
          schedule: "Takvim",
          doctors: "Doktorlar",
          chat: "Mesajlar",
          leads: "Lead gelen kutusu",
          leadsNeedsAssignment: "Atama gerekli",
          leadsRecentlyRouted: "Yeni yönlendirilen",
          leadsAssigned: "Atanmış",
          aiLeads: "Koordinasyon Merkezi",
          files: "Dosyalar",
          referrals: "Referanslar",
          marketplaceProfile: "Dizin Profili",
          successCenter: "Başarı Merkezi",
          helpCenter: "Yardım Merkezi",
          learningCandidates: "AI Öğrenme",
          health: "Sağlık",
          settings: "Ayarlar",
          login: "Login",
          register: "Klinik Kaydı"
        },
        charts: {
          metricTitleMonthlyPatients: "Aylık Kaydolan Kullanıcı Sayısı",
          metricTitleMonthlyProcedures: "Aylık İşlem Sayısı",
          chartLabelMonthlyRegistered: "Aylık kayıt",
          activePatients: "Aktif Kullanıcılar",
          procedures: "Prosedürler",
          noData: "Veri yok",
          trendNote: "Daha fazla veri toplandıkça trend iyileşecek",
          vsPreviousMonth: "önceki aya göre",
          noPreviousData: "Önceki veri yok",
          summaryActivePatients: "{count} aktif kullanıcı • {month}",
          summaryMonthlyRegistered: "{count} kayıt • {month}",
          summaryProcedures: "{count} prosedür • {month}"
        },
        clinicBadge: {
          noToken: "⚠️ Admin token yok. <a href=\"/admin-register.html\" style=\"color:var(--link);\">Klinik Kaydı</a> ile giriş yapın.",
          switchClinic: "Klinik değiştir",
          clinicInfo: "Klinik: <strong>{name}</strong> ({code}) • Durum: {status}",
          clinicNotFound: "Clinic bilgisi alınamadı. Lütfen admin token'ı kontrol edin."
        },
        upcoming: {
          title: "📅 Clinic Timeline",
          subtitle: "Tüm event'ler (geçmiş ve gelecek)",
          empty: "Event yok.",
          overdue: "⚠️ Gecikmiş Eventler ({count})",
          overdueDesc: "Tarihi geçmiş ama tamamlanmamış {count} event var. Lütfen kontrol edin.",
          status: {
            planned: "Planlandı",
            done: "Tamamlandı",
            completed: "Tamamlandı"
          },
          today: "Bugün",
          tomorrow: "Yarın",
          dayAfterTomorrow: "Öbür gün",
          daysLater: "{count} gün sonra",
          weeksLater: "{count} hafta sonra",
          eventTypes: {
            TRAVEL_EVENT: "Seyahat Etkinliği",
            FLIGHT: "Uçuş",
            HOTEL: "Otel",
            AIRPORT_PICKUP: "Havalimanı Karşılama",
            TREATMENT: "Tedavi",
            CONSULT: "Muayene",
            FOLLOWUP: "Kontrol",
            LAB: "Laboratuvar / Tarama",
            HEALTH: "Sağlık Formu",
            APPOINTMENT: "Randevu",
            PAYMENT: "Ödeme",
            SURGERY: "Cerrahi",
            CHECKUP: "Kontrol"
          },
          summary: {
            overdue: "Gecikmiş:",
            today: "Bugün:",
            tomorrow: "Yarın:",
            patients: "hasta",
            events: "etkinlik"
          }
        },
        planUsage: "Plan ve kullanım",
        activeTreatments: "Aktif tedaviler",
        monthlyUploads: "Aylık yüklemeler",
        referralInvites: "Referans davetleri",
        totalReferrers: "Toplam referans veren",
        patientRoster: "Kullanıcı kaydı (limit)",
        usagePeriodNote: "Aylık kullanım dönemi (UTC): {period}",
        usageFreshness: "Verilerin güncellenme zamanı: {time}",
        upgrade: "Yükselt",
        unlimited: "Sınırsız",
        planAlertCrit: "Limite ulaşıldı. Devam etmek için yükseltin.",
        planAlertWarn: "Limitinize yaklaştınız",
        planTierTitle: "Mevcut abonelik seviyesi",
        confirmOpenPricing: "Fiyatlandırma sayfası açılsın mı?\n\n{url}",
        metricsErrorHint: "Ayrıntılar için tarayıcı konsoluna (F12) bakın"
      },
      
      calendar: {
        documentTitle: "Takvim - Clinifly Admin",
        pageTitle: "Randevu Takvimi",
        title: "Randevu Takvimi",
        weekRangeTitle: "Hafta aralığı",
        today: "Bugün",
        week: "Hafta",
        month: "Ay",
        prev: "← Önceki",
        previous: "← Önceki",
        next: "Sonraki →",
        timeColumn: "Saat",
        doctor: "Doktor",
        chair: "Koltuk",
        allDoctors: "Tüm Doktorlar",
        allChairs: "Tüm Koltuklar",
        noEvents: "Etkinlik yok",
        noAppointmentsForWeek: "Seçili hafta için randevu bulunamadı.",
        noAppointmentsForRange: "Seçili dönem için randevu bulunamadı.",
        summaryLine: "{count} randevu • {doctorCount} doktor • {chairCount} koltuk",
        loading: "Yükleniyor...",
        tokenMissing: "Admin token bulunamadı. Tekrar giriş yapın.",
        sessionExpired: "Oturum süresi doldu. Giriş sayfasına yönlendiriliyorsunuz...",
        fetchFailed: "Randevular alınamadı: {message}",
        doctorNotFound: "Doktor bulunamadı",
        chairWithNumber: "Koltuk {n}"
      },
      
      // Pricing (pricing.html)
      pricing: {
        title: "Clinifly Fiyatlandırma",
        subtitle: "Aktif kullanıcı sayınıza göre esnek planlar",
        info: "Sadece aktif kullanıcı sayınıza göre ödeme yapın.",
        free: {
          name: "Free",
          patients: "5 Kullanıcı",
          description: "Clinifly'i gerçek kullanıcılarla denemeniz için.",
          cta: "Başla"
        },
        basic: {
          name: "Pro",
          badge: "Popüler",
          patients: "15 Kullanıcı",
          description: "Büyüyen klinikler için güçlü paket.",
          cta: "Upgrade Et"
        },
        pro: {
          name: "Premium",
          patients: "Sınırsız kullanıcı",
          description: "Kurumsal klinikler için premium destek.",
          cta: "Upgrade Et",
          contactCta: "İletişime Geç"
        },
        periodMonthly: "/ay",
        features: {
          allCore: "Tüm core özellikler",
          patientCommunication: "Kullanıcı iletişimi",
          fileSharing: "Dosya paylaşımı",
          referral: "Referral sistemi",
          branding: "Clinifly branding",
          customBranding: "Özel branding",
          analytics: "Temel analizler",
          support: "E-posta desteği",
          unlimitedPatients: "Sınırsız kullanıcı",
          advancedReferral: "Gelişmiş referral (level, kampanya)",
          prioritySupport: "Öncelikli destek",
          onboarding: "Özel onboarding"
        },
        comparison: {
          feature: "Özellik",
          free: "Free",
          basic: "Pro",
          pro: "Premium",
          patients: "Aktif Kullanıcı Sayısı",
          unlimited: "Sınırsız",
          coreFeatures: "Core Özellikler",
          branding: "Clinifly Branding",
          customBranding: "Özel Branding",
          referral: "Referral Sistemi",
          advancedReferral: "Gelişmiş Referral",
          analytics: "Analizler",
          support: "Destek",
          community: "Topluluk",
          email: "E-posta",
          priority: "Öncelikli"
        },
        faq: {
          title: "Sıkça Sorulan Sorular",
          q1: {
            question: "Aktif kullanıcı sayısı nasıl hesaplanır?",
            answer: "Sadece APPROVED (onaylı) durumundaki kullanıcılar sayılır. Pending, rejected veya cancelled durumundaki kullanıcılar limite dahil edilmez."
          },
          q2: {
            question: "Limit dolduğunda ne olur?",
            answer: "Mevcut kullanıcılarınızla çalışmaya devam edebilirsiniz. Sadece yeni kullanıcı onayı engellenir. Upgrade yaptığınızda işlemlerinize devam edebilirsiniz."
          },
          q3: {
            question: "Plan değiştirebilir miyim?",
            answer: "Evet, istediğiniz zaman planınızı yükseltebilir veya düşürebilirsiniz. Değişiklikler anında geçerli olur."
          },
          q4: {
            question: "Ödeme yöntemleri nelerdir?",
            answer: "Kredi kartı, banka transferi ve yerel ödeme yöntemlerini kabul ediyoruz. Ödemeler SSL güvenliği ile korunur."
          }
        },
        contact: {
          title: "Özel ihtiyaçlarınız mı var?",
          description: "Büyük klinikler ve kurumsal çözümler için özel planlar sunuyoruz.",
          button: "İletişime Geç"
        }
      },
      
      // Treatment (admin-treatment.html) — tek `treatment` objesi (duplicate key yok)
      treatment: {
        patientName: "Kullanıcı Adı (Seç)",
        selectPatient: "— Kullanıcı seç —",
        patientHelp: "Kullanıcı listesinden Treatment'a basınca otomatik seçilir. Buradan kullanıcı değiştirince otomatik yüklenir.",
        noPatientSelected: "Kullanıcı seçilmedi. Lütfen kullanıcı seçin.",
        loadingTreatments: "Tedaviler yükleniyor...",
        noTreatments: "Bu kullanıcı için tedavi planı bulunamadı.",
        addTreatment: "Tedavi Ekle",
        saveTreatment: "Tedaviyi Kaydet",
        treatmentSaved: "✅ Tedavi başarıyla kaydedildi!",
        treatmentDeleted: "✅ Tedavi başarıyla silindi!",
        confirmDelete: "Bu tedaviyi silmek istediğinizden emin misiniz?",
        pageTitle: "Tedaviler - Clinifly Admin",
        upperJaw: "Üst Çene",
        lowerJaw: "Alt Çene",
        fdiUpper: "FDI 11–18 / 21–28",
        fdiLower: "FDI 31–38 / 41–48",
        selectedTooth: "Seçili Diş:",
        selToothHint: "Dişe tıkla, işlem ekle.",
        clearSelection: "Seçimi Temizle",
        procedureType: "İşlem Türü",
        loadingProcedures: "Yükleniyor...",
        statusLabel: "Durum",
        dateLabel: "Tarih",
        timeLabel: "Saat",
        datePolicy: "Tarih Politikası",
        datePolicyManual: "MANUAL (alarm oluştur)",
        datePolicyAuto: "AUTO (otomatik tarih ata)",
        priceOptional: "Fiyat (ops.)",
        currencyLabel: "Para Birimi",
        quantityLabel: "Adet",
        chairNo: "Chair No",
        doctorLabel: "Doktor",
        doctorSelectOptional: "-- Doktor Seç (ops.) --",
        addProcedure: "+ Prosedur Ekle",
        diagnosesOnTooth: "Bu dişteki tanılar",
        addDiagnosisBtn: "+ Tanı Ekle",
        newDiagnosisTitle: "Yeni Tanı Ekle",
        icdCodeLabel: "ICD-10 Kodu",
        descriptionLabel: "Açıklama",
        toothNoLabel: "Diş No",
        toothPlaceholderAuto: "otomatik",
        notesOptionalLabel: "Not (ops.)",
        notesPlaceholder: "Opsiyonel not...",
        proceduresOnTooth: "Bu dişteki işlemler",
        treatmentEventsTitle: "🦷 Treatment Events (Takvim)",
        treatmentEventsHelp: "Not: Event'ler treatment_events tablosunda saklanır.",
        eventTitlePlaceholder: "Implant Day 1",
        eventDescPlaceholder: "CT scan + implant placement",
        teTypeTreatment: "Treatment",
        teTypeConsult: "Consultation",
        teTypeFollowup: "Follow-up",
        teTypeLab: "Lab / Scan",
        addEvent: "➕ Event Ekle",
        eventListTitle: "Event listesi",
        thDateTime: "Tarih/Saat",
        thType: "Tip",
        thTitle: "Başlık",
        patientToothDiagnoses: "Kullanıcının Diş Tanıları",
        badgeToothDoctor: "Diş No + Doktor Tanısı",
        noDiagnosisSummary: "Tanı kaydı bulunamadı.",
        emptyStateTitle: "Henüz treatment kaydı yok",
        emptyStateSub: "Treatment'lar yüklendiğinde burada görünecek.",
        selectPatientAbove: "Yukarıdan bir kullanıcı seçin.",
        loadingTreatmentsMsg: "Treatments yükleniyor...",
        loadFailed: "Yüklenemedi: {error}",
        noRecordsYet: "Henüz treatment kaydı yok. Diş seçip işlem ekleyebilirsiniz.",
        loadedSummary: "{teethCount} dişte toplam {procCount} işlem yüklendi.",
        headerTitle: "Tedavi",
        loadError: "Yükleme hatası: {error}",
        selectToothFirst: "⚠️ Önce diş seçin",
        toothLocked: "Bu diş çekilmiş (locked). Yeni işlem eklenemez.",
        selectProcedureType: "İşlem türü seç.",
        invalidDateTime: "Tarih/saat formatı geçersiz.",
        diagCodeOrDesc: "ICD-10 kodu veya açıklama giriniz.",
        saveFailedWithMsg: "Kaydedilemedi: {error}",
        deleteFailedWithMsg: "Silinemedi: {error}",
        errorWithMsg: "Hata: {error}",
        saveAllSuccess: "Tüm procedure'lar kaydedildi ✅",
        saveAllError: "Kaydetme hatası: {error}",
        deleteBtn: "Sil",
        eventsEmpty: "Event yok.",
        procLineTooth: "Diş {tooth} • ",
        selToothHintLocked: "⛔ Bu diş çekilmiş (locked). Yeni işlem eklenemez. Sadece geçmiş görülebilir.",
        pickToothFromChart: "Diş seçmek için yukarıdaki diş haritasından bir dişe tıklayın.",
        noProcOnTooth: "Bu dişte henüz işlem yok.",
        noDiagOnTooth: "Bu dişte tanı kaydı yok.",
        noDescription: "Açıklama yok",
        diagGroupTooth: "🦷 Diş {tooth}",
        diagGroupGeneral: "🦷 Genel Tanılar",
        diagNotAdded: "Tanı eklenmemiş",
        toothDiagCountTitle: "Bu dişte {count} tanı kaydı var",
        datePrefix: "Tarih:",
        chairLabel: "Chair",
        editInlineTitle: "Satır içinde düzenle",
        statusSelectTitle: "Status seç",
        statusCycleTitle: "Status'ü değiştirmek için tıklayın (PLANNED → ACTIVE → COMPLETED → CANCELLED → PLANNED)",
        inlineProcTypePh: "İşlem tipi",
        inlineUnitPricePh: "Birim fiyat",
        inlineQtyPh: "Adet",
        inlineChairPh: "Chair No",
        inlineDoctorPick: "-- Doktor Seç --",
        deleteTitle: "Sil",
        selToothHintActive: "Diş seçin",
        status: {
          PLANNED: "Planlandı",
          ACTIVE: "Devam Ediyor",
          COMPLETED: "Tamamlandı",
          CANCELLED: "İptal"
        }
      },
      
      // Login (admin-login.html)
      login: {
        title: "Klinik Girişi",
        subtitle: "Mevcut klinik hesabınızla giriş yapın",
        clinicCode: "Clinic Code",
        clinicCodeRequired: "*",
        clinicCodePlaceholder: "SAAT",
        clinicCodeHelp: "Klinik kodunuzu giriniz (örn: SAAT, MOON, CLINIC01)",
        password: "Password",
        passwordRequired: "*",
        passwordHelp: "Klinik şifrenizi giriniz",
        submit: "Login",
        submitLoading: "Giriş yapılıyor...",
        registerLink: "Yeni Klinik Kaydı",
        dashboardLink: "Dashboard'a Git",
        forgotPasswordLink: "Şifremi unuttum",
        forgotTitle: "Şifremi unuttum",
        forgotSubtitle: "Klinik kodunuz ve kayıtlı e-postanıza 6 haneli doğrulama kodu gönderilir.",
        forgotSend: "Doğrulama kodu gönder",
        forgotResend: "Kodu yeniden gönder",
        forgotResendWait: "Yeniden gönder",
        forgotOtpTitle: "E-posta doğrulama",
        forgotOtpSubtitle: "E-postanıza gelen 6 haneli kodu girin.",
        forgotOtpCode: "Doğrulama kodu",
        forgotVerifyOtp: "Kodu doğrula",
        forgotSetPasswordTitle: "Yeni şifre",
        forgotSetPasswordSubtitle: "Doğrulama tamam — yeni şifrenizi belirleyin.",
        forgotNewPassword: "Yeni şifre",
        forgotConfirmPassword: "Yeni şifre (tekrar)",
        forgotReset: "Şifreyi kaydet",
        forgotBack: "Girişe dön",
        forgotSuccess: "Şifreniz güncellendi. Giriş yapabilirsiniz.",
        forgotOtpSent: "Doğrulama kodu e-postanıza gönderildi.",
        forgotPasswordMismatch: "Şifreler eşleşmiyor.",
        forgotPasswordTooShort: "Şifre en az 6 karakter olmalıdır.",
        forgotInvalidIdentity: "Klinik kodu veya e-posta eşleşmedi.",
        forgotResetFailed: "Şifre güncellenemedi. Lütfen tekrar deneyin.",
        forgotOtpInvalid: "Geçersiz veya süresi dolmuş kod.",
        forgotOtpRequired: "Önce e-posta doğrulamasını tamamlayın.",
        forgotRateLimit: "Lütfen 1 dakika bekleyip tekrar deneyin.",
        success: "Hoş geldiniz {name}! Giriş başarılı.",
        loginSuccess: "Giriş başarılı",
        sessionExpired: "⏰ Oturum süreniz doldu veya token geçersiz. Lütfen tekrar giriş yapın.",
        otpTitle: "OTP Doğrulama",
        otpSubtitle: "E-postanıza gönderilen doğrulama kodunu girin",
        otpEmailHelp: "OTP aldığınız e-posta adresini girin",
        otpCode: "Doğrulama Kodu",
        otpCodeRequired: "*",
        otpHelp: "E-postanıza gönderilen 6 haneli kodu girin",
        verifyOTP: "OTP Doğrula",
        verifying: "Doğrulanıyor",
        backToLogin: "Girişe Dön",
        errors: {
          clinicCodeRequired: "Lütfen klinik kodunu giriniz.",
          passwordRequired: "Lütfen şifrenizi giriniz.",
          emailRequired: "Lütfen e-posta adresini giriniz.",
          invalidCredentials: "Klinik kodu veya şifre hatalı. Lütfen tekrar deneyin.",
          loginFailed: "Giriş başarısız. Lütfen tekrar deneyin.",
          loginFailedDetail: "Giriş başarısız: {detail}",
          serverError: "Sunucu hatası",
          apiNotJson: "API JSON döndürmedi (HTML/hata sayfası). Muhtemelen yanlış API kökü: {api}",
          genericError: "Giriş hatası: {error}",
          otpRequired: "Lütfen doğrulama kodunu giriniz.",
          otpInvalid: "Geçersiz doğrulama kodu. 6 haneli kod giriniz.",
          otpFailed: "Doğrulama başarısız. Lütfen tekrar deneyin.",
          otpNotFound: "Doğrulama kodu bulunamadı. Lütfen yeni kod isteyin.",
          otpExpired: "Doğrulama kodunun süresi doldu. Lütfen yeni kod isteyin."
        }
      },

      auth: {
        email: "E-posta",
        password: "Şifre",
        confirm_password: "Şifreyi doğrula",
        name: "Ad soyad",
      },
      
      // Register (admin-register.html)
      register: {
        title: "Create Your Clinic",
        subtitle: "Get started in minutes — it's free.",
        clinicCode: "Klinik Kodu",
        clinicCodeRequired: "*",
        clinicCodeWhat: "Klinik kodu nedir?",
        clinicCodeHelp: "Klinik kodu, kliniğinizin kısa ve benzersiz sembolüdür — tıpkı bir plaka veya kısaltma gibi. Kayıt sırasında siz belirlersiniz; kullanıcılar uygulamada bu kodu girerek kliniğinize bağlanır.",
        clinicCodeTip1: "3–12 karakter; sadece büyük harf ve rakam (ör. CEM, ELKO, MOON)",
        clinicCodeTip2: "Klinik adınızdan türetin veya kolay hatırlanacak bir sembol seçin",
        clinicCodeTip3: "Bu kod şifreniz değildir — kullanıcılarınızla paylaşabilirsiniz",
        clinicCodePlaceholder: "ör. CEM, ELKO, MOON",
        clinicCodeHint: "Örnekler: CEM, ELKO, SMILE",
        invitationCode: "Davet Kodu",
        invitationCodeOptional: "(İsteğe bağlı)",
        invitationCodeHelp: "Kampanya kodunuz varsa, premium deneme sürenizi etkinleştirmek için girin.",
        name: "Clinic Name",
        nameRequired: "*",
        namePlaceholder: "Moon Clinic",
        nameHelp: "Klinik adınız",
        email: "Email",
        emailRequired: "*",
        emailPlaceholder: "clinic@example.com",
        emailHelp: "Klinik e-posta adresiniz",
        password: "Password",
        passwordRequired: "*",
        passwordHelp: "Minimum 6 characters",
        confirmPassword: "Confirm Password",
        confirmPasswordRequired: "*",
        confirmPasswordHelp: "Must match the password",
        phone: "Phone",
        phonePlaceholder: "+90 555 123 4567",
        address: "Address",
        addressPlaceholder: "İstanbul, Türkiye",
        submit: "Register Clinic",
        submitLoading: "Kaydediliyor...",
        loginLink: "Zaten hesabınız var mı? Login",
        dashboardLink: "Dashboard'a Git",
        errors: {
          clinicCodeRequired: "Lütfen klinik kodunu giriniz.",
          nameRequired: "Lütfen klinik adını giriniz.",
          emailRequired: "Lütfen e-posta adresini giriniz.",
          emailInvalid: "Geçerli bir e-posta adresi giriniz.",
          emailExists: "Bu e-posta adresi zaten kullanılıyor.",
          clinicCodeExists: "Bu klinik kodu zaten kullanılıyor.",
          passwordRequired: "Lütfen şifrenizi giriniz.",
          passwordMinLength: "Şifre en az 6 karakter olmalıdır.",
          passwordMismatch: "Şifreler eşleşmiyor.",
          registerFailed: "Kayıt başarısız. Lütfen tekrar deneyin.",
          genericError: "Kayıt hatası: {error}",
          termsNotAccepted: "Lütfen hizmet sözleşmesini kabul edin.",
          timeout: "İstek zaman aşımı (60 sn). API adresi ve internet bağlantısını kontrol edin."
        },
        success: "Klinik kaydı başarılı! Giriş sayfasına yönlendiriliyorsunuz...",
        successTitle: "Kayıt Başarılı!",
        successMessage: "Klinik başarıyla kaydedildi. Admin token tarayıcınıza kaydedildi.",
        clinicInformation: "Klinik Bilgileri",
        adminToken: "Admin Token",
        copyToken: "📋 Token'ı Kopyala",
        goToPatients: "Kullanıcı Listesine Git",
        goToDashboard: "Dashboard'a Git",
        termsText: "Clinifly Dijital Platform Hizmet Sözleşmesi'ni okudum, anladım ve kabul ediyorum. Free Paket kapsamındaki hizmetlerin ücretsiz olduğunu, Free Paket dışındaki dijital hizmetlerin ücretli olduğunu ve bu hizmetlerin kapsam ile bedelinin ayrıca belirleneceğini kabul ederim.",
        connectingRetry: "⏳ Bağlanıyor… {seconds}s sonra tekrar",
        otp: {
          title: "E-posta Doğrulama",
          intro: "{email} adresine bir doğrulama kodu gönderdik. Klinik kaydını tamamlamak için kodu aşağıya girin.",
          codeLabel: "Doğrulama Kodu",
          codeHelp: "E-postanızdaki 6 haneli kodu girin",
          verify: "Doğrula ve Kaydı Tamamla",
          verifying: "Doğrulanıyor...",
          resend: "Kodu Yeniden Gönder",
          sending: "Gönderiliyor...",
          back: "Kayda Geri Dön",
          invalidCode: "Lütfen geçerli 6 haneli bir doğrulama kodu girin",
          resent: "E-postanıza yeni bir doğrulama kodu gönderildi",
          clinicCodeExists: "Klinik kodu {code} zaten kayıtlı. Giriş sayfasına yönlendiriliyorsunuz...",
          emailExists: "E-posta {email} zaten kayıtlı. Giriş sayfasına yönlendiriliyorsunuz..."
        }
      },
      
      // Settings (admin-settings.html)
      settings: {
        title: "⚙️ Clinic Settings",
        pageTitle: "⚙️ Clinifly Admin – Settings",
        clinicInformation: "Klinik Bilgileri",
        brandingNotice: "Branding ayarları yalnızca PRO plan için kullanılabilir.",
        subscriptionPlan: "Abonelik Paketi",
        subscriptionPlanHelp: "FREE / BASIC / PRO paketini buradan değiştirebilirsiniz.",
        usageLoading: "Yükleniyor…",
        usageActiveTreatments: "Aktif tedaviler",
        usageMonthlyUploads: "Aylık yüklemeler (UTC ayı)",
        usageReferrals: "Referans davetleri (bu UTC ayı)",
        usagePeriodNote: "Ölçüm dönemi (UTC ay): {period}",
        usagePatients: "Kayıtlı kullanıcılar (limit)",
        usageLoadFailed: "Kullanım bilgisi alınamadı.",
        usageFreshness: "Anlık görüntü zamanı: {time}",
        currentPlan: "Mevcut Plan: {plan}",
        planUpgrade: "Planı Yükselt",
        planChangesNote: "Plan değişiklikleri fiyatlandırma sayfasından yapılır.",
        locationTitle: "Konum",
        locationAllPlans: "TÜM PLANLAR",
        countryLabel: "Ülke",
        cityLabel: "Şehir",
        cityPlaceholder: "Antalya, İstanbul, Londra, Tbilisi...",
        locationDiscoveryHelp: "Kullanıcılar keşifte ülke ve şehre göre klinik filtreleyebilir.",
        selectCountry: "Ülke seçin",
        countryRequiredAlert: "Lütfen bir ülke seçin.",
        cityRequiredAlert: "Şehir gereklidir.",
        plan: "Plan",
        branding: "Branding",
        clinicName: "Klinik Adı",
        clinicLogoUrl: "Klinik Logo URL",
        clinicLogoUrlHelp: "Pro plan için logo görüntülenir",
        chairCountLabel: "Koltuk sayısı",
        chairCountHelp: "Randevu ekranında gösterilecek koltuk sayısı (örn: 1, 2, 3).",
        address: "Klinik Adresi",
        addressHelp: "Zorunlu (tüm planlar). Yakındaki klinik araması ve konum; adres Google ile geocode edilir.",
        googleMapLink: "Google Haritalar Bağlantısı",
        googleMapLinkHelp: "İsteğe bağlı (tüm planlar). Varsa bağlantıdan koordinat alınır; yoksa yalnızca adres kullanılır.",
        welcomeMessage: "Karşılama Mesajı",
        primaryColor: "Birincil Renk (Hex)",
        secondaryColor: "İkincil Renk (Hex)",
        referralDiscounts: "🎁 Referans İndirimleri",
        referralDiscountsHelp: "Başarılı referanslar için indirim yüzdelerini ayarlayın. Hem davet eden hem de davet edilen kullanıcı bu indirimleri alır.",
        referralDiscount: "Referans İndirimi (%)",
        referralDiscountHelp: "Hem davet eden hem davet edilen kullanıcıya uygulanan indirim",
        aiCommunication: {
          title: "YZ İletişimi",
          desc: "Messenger, Instagram ve WhatsApp'ta ilk yanıt hızını ayarlayın. <strong>Anında</strong> modda YZ saniyeler içinde karşılar. <strong>İnsanı bekle</strong> modunda ekip yanıtlamazsa belirlediğiniz süre sonunda YZ devreye girer.",
          instant: "Anında YZ yanıtları (Messenger/WhatsApp — mesajları gruplayarak tek yanıt)",
          waitHuman: "YZ'den önce insanı bekle",
          humanOnly: "Yalnızca insan (otomatik YZ yanıtı yok)",
          timingHintInstant:
            "Anında mod: Kullanıcı art arda birkaç kısa mesaj yazarsa YZ kısa bir süre bekler, sonra hepsine tek yanıt verir. Önerilen: 5 saniye.",
          timingHintWait:
            "«İnsanı bekle» modunda ekip belirtilen süre içinde yazmazsa YZ ilk mesajı gönderir. Anında karşılama yoktur.",
          timingHintHumanOnly:
            "Messenger ve WhatsApp'ta otomatik YZ yanıtı kapalıdır; tüm mesajları ekibiniz yanıtlar.",
          humanTakeoverLabel: "Ekip yanıtlamazsa YZ devreye girsin (bekleme süresi)",
          secondsWord: "sn",
          messageBufferLabel: "YZ yanıt gecikmesi (hızlı mesajları grupla)",
          bufferInstant: "Anında (gruplama yok)",
          buffer3s: "3 saniye",
          buffer5s: "5 saniye (önerilen)",
          buffer10s: "10 saniye",
          messageBufferHelp:
            "Kullanıcı art arda kısa mesajlar gönderirse, son mesajdan sonra bu süre kadar beklenir; ardından tümüne tek YZ yanıtı gider (Messenger / WhatsApp / Instagram).",
          omniDelayLabel: "Anında yanıt gecikmesi (Messenger / WhatsApp)",
          omniDelayHelp:
            "Artık «YZ yanıt gecikmesi» ayarını kullanın. Hızlı mesajları gruplayarak tek yanıt için 5 sn önerilir.",
          fallbackHelp:
            "Yalnızca «İnsanı bekle» modunda: ekip bu süre içinde yazmazsa YZ ilk mesajı atar.",
          bookingModeLabel: "YZ takvim randevu modu",
          bookingDraft: "Taslak randevu (ekip onayı) — önerilen",
          bookingSuggest: "Yalnızca saat öner (takvime yazma)",
          bookingAuto: "Tam otomatik randevu (anında onaylı)",
          bookingHint: "YZ gerçek takvim müsaitliğini kontrol eder; randevudan önce telefon/WhatsApp ister; çalışma saatleri, buffer ve öğle arasına uyar.",
          clinicHoursLabel: "Klinik çalışma saatleri (YZ randevu)",
          clinicOpenLabel: "Açılış",
          clinicCloseLabel: "Kapanış",
          clinicTimezoneLabel: "Klinik saat dilimi",
          clinicHoursHint: "YZ yalnızca bu saatler arasında randevu önerir (klinik yerel saati). Kullanıcı mesai dışı saat isterse bir sonraki uygun slotu sunar.",
          weekdayBlockTitle: "Hafta içi (Pazartesi–Cuma)",
          saturdayBlockTitle: "Cumartesi saatleri",
          sundayBlockTitle: "Pazar saatleri",
          enableSaturday: "Cumartesi açık",
          enableSunday: "Pazar açık",
          weekday24Hours: "24 saat açık (Pzt–Cum)",
          day24Hours: "24 saat açık",
          open247: "7/24 açık (tüm günler)",
          save: "YZ iletişimini kaydet",
          loading: "Yükleniyor…",
          signInRequired: "YZ iletişimini yapılandırmak için giriş yapın.",
          loadFailed: "YZ iletişim ayarları yüklenemedi.",
          saving: "Kaydediliyor…",
          saveFailed: "Kaydetme başarısız: {error}",
          saved: "Kaydedildi. Messenger/WhatsApp bu yanıt zamanlamasını kullanacak.",
        },
        communicationChannels: {
          title: "İletişim Kanalları",
          desc: "Harici kanalları bağlayın; kullanıcı mesajları YZ koordinatör gelen kutunuzda kaynak rozetleriyle görünsün (WhatsApp, Messenger, Instagram, Web).",
          whatsapp: "WhatsApp →",
          messenger: "Messenger →",
        },
        colorCategories: {
          blue: "Mavi / Güven",
          green: "Yeşil / Sağlık",
          purple: "Mor / Premium",
          orange: "Turuncu / Aksiyon",
          red: "Kırmızı / Kampanya",
          neutral: "Nötr / Kurumsal",
        },
        variants: {
          options: "Seçenekler",
          btn: "Varyantlar",
          btnHide: "Varyantları gizle",
          aiNamesBtn: "YZ adları",
          aiNamesHide: "YZ adlarını gizle",
          brandVariantTitle: "Marka varyantı {n}",
          remove: "Kaldır",
          brand: "Marka *",
          country: "Menşe ülkesi",
          tier: "Segment / kademe",
          priceFrom: "Fiyat (min)",
          priceTo: "Fiyat (max)",
          currency: "Para birimi",
          aiNotes: "YZ notları",
          defaultOption: "Bu tedavi için varsayılan seçenek",
          panelTitle: "{treatment} — marka / malzeme varyantları",
          panelHint: "Her varyant marka + menşe + segment + fiyat aralığıdır (ör. Straumann / İsviçre / Premium / 900–1200 EUR). YZ yalnızca tahmini dil kullanır.",
          addVariant: "+ Varyant ekle",
          labelsPanelTitle: "YZ görünen adları (isteğe bağlı çeviriler)",
          labelsPanelHint: "Çok dilli YZ yanıtları için yerelleştirilmiş tedavi adları — marka veya fiyat varyantı değildir.",
          labelPlaceholder: "İsteğe bağlı YZ görünen adı",
        },
        referralLevel1: "Seviye 1 (%)",
        referralLevel1Help: "1. başarılı referral sonrası toplam indirim",
        referralSettings: "🎯 Referral Ayarları",
        referralSettingsHelp: "Davet sistemi için kazanç oranlarını belirleyin. PRO planında esnek ayarlar mevcuttur.",
        referralPerInvite: "Davet başına kazanç (%)",
        referralPerInvitePlaceholder: "10",
        referralPerInviteHelp: "Her başarılı davet için verilecek indirim",
        referralMaxTotal: "Maksimum toplam indirim (%)",
        referralMaxTotalPlaceholder: "10",
        referralMaxTotalHelp: "Davet edenin kazanabileceği maksimum indirim. Eğer davet eden 1'den fazla kişi davet ederse ve davet edilenlerin harcaması davet edenden fazla olursa, maksimum indirim limitine kadar indirim uygulanabilir.",
        referralLevel2: "Seviye 2 (%)",
        referralLevel2Help: "2. başarılı referral sonrası toplam indirim",
        referralLevel3: "Seviye 3 (%)",
        referralLevel3Help: "3+ referral için maksimum indirim",
        temporaryPatientLimit: "🔧 Geçici Kullanıcı Limiti",
        temporaryPatientLimitHelp: "Satış ve onboarding süreçleri için geçici kullanıcı limiti ekleyin. Bu, normal plan limitinin üzerine eklenir.",
        temporaryLimit: "Geçici Limit",
        temporaryLimitPlaceholder: "Ek kullanıcı sayısı (örn: 5)",
        saveTemporaryLimit: "Geçici Limiti Kaydet",
        removeTemporaryLimit: "Geçici Limiti Kaldır",
        temporaryLimitActive: "Mevcut geçici limit: +{count} kullanıcı",
        referralPreviewLabel: "💡 Önizleme:",
        referralPreviewNone: "❌ İndirim uygulanmayacak",
        referralPreviewLow: "✅ <strong>{discount}% indirim</strong> hem davet eden hem de davet edilen kullanıcıya uygulanacak.<br><span style=\"color:#10b981\">💡 Yeni kullanıcı çekmek için harika bir başlangıç!</span>",
        referralPreviewMid: "🎉 <strong>{discount}% indirim</strong> her iki tarafa da uygulanacak.<br><span style=\"color:#f59e0b\">⚠️ Daha yüksek indirim ama daha çekici referanslar!</span>",
        referralPreviewHigh: "🚀 <strong>{discount}% indirim</strong> - Maksimum seviye!<br><span style=\"color:#ef4444\">⚠️ Çok cömert - kârlılığı kontrol edin!</span>",
        save: "💾 Ayarları Kaydet",
        saveLoading: "Kaydediliyor...",
        treatmentPriceList: "💰 Tedavi Fiyat Listesi",
        treatmentPriceListHelp: "Randevu fiyatlandırması ve YZ koordinatör yanıtları için tek kaynak. Marka/malzeme/fiyat seçenekleri için <strong>Varyantlar</strong> kullanın (ör. Straumann, Megagen). <strong>YZ adları</strong> yalnızca isteğe bağlı çok dilli tedavi etiketleri içindir — markalar için değil.",
        currency: "Para Birimi",
        loadingPrices: "Fiyatlar yükleniyor...",
        saveAllPrices: "💾 Tüm Fiyatları Kaydet",
        savingPrices: "💾 Kaydediliyor...",
        pricesSaved: "✅ Tüm fiyatlar başarıyla kaydedildi!",
        errors: {
          noToken: "Admin token bulunamadı. Lütfen admin olarak giriş yapın.",
          loadFailed: "Ayarlar yüklenemedi: {error}",
          saveFailed: "Ayarlar kaydedilemedi: {error}",
          pricesLoadFailed: "Fiyatlar yüklenemedi: {error}",
          pricesSaveFailed: "Fiyatlar kaydedilemedi: {error}"
        },
        success: "✅ Ayarlar başarıyla kaydedildi!",
        categoryLabels: {
          EVENTS: "Muayene / Görüntüleme",
          PROSTHETIC: "Prosthetic (Protez)",
          RESTORATIVE: "Restorative (Restoratif)",
          ENDODONTIC: "Endodontic (Endodontik)",
          SURGICAL: "Surgical (Cerrahi)",
          IMPLANT: "Implant"
        },
        tableHeaders: {
          treatment: "İşlem",
          price: "Fiyat",
          recommended: "Önerilen",
          duration: "Süre (dk)",
          breakMin: "Mola (dk)",
          active: "Aktif",
          options: "Seçenekler",
        },
        recommendedDuration: "~{minutes} dk",
        minutes: "dk",
        opsProfileCardTitle: "Klinik YZ Eğitimi",
        opsProfileCardDesc: "Yapay zekanın kliniğinizi nasıl temsil edeceğini, hangi bilgileri kullanacağını ve kullanıcılara nasıl yanıt vereceğini yapılandırın.",
        opsProfileCardPricing: "Fiyatlandırma ve marka varyantları aşağıdaki <strong>Tedavi Fiyat Listesi</strong>nde yapılandırılır (randevu + YZ için tek kaynak).",
        opsProfileOpen: "YZ Eğitim Merkezi →",
      },

      opsProfile: {
        pageTitle: "Klinik YZ Eğitimi — Clinifly Admin",
        title: "Klinik YZ Eğitimi",
        lead: "Yapay zekanın kliniğinizi nasıl temsil edeceğini, hangi bilgileri kullanacağını ve kullanıcılara nasıl yanıt vereceğini yapılandırın.",
        policyLayerTitle: "Klinik geneli YZ kuralları (izin verilen üst sınır)",
        policyLayerBody: "YZ'nin klinik genelinde ne yapabileceğini tanımlayın — kategoriler, güvenlik, diller ve eskalasyon. Bu üst sınırdır; koordinatör ve hekimler her kullanıcı için Koordinasyon Merkezi veya hekim uygulamasında canlı modu seçer.",
        liveControlNote: "Kullanıcı bazlı Kapalı / Destek / Aktif burada ayarlanmaz — her başvuruda canlı YZ koordinasyonunu kullanın.",
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
        openJourneys: "Tedavi iş akışlarını aç",
        openHotelManager: "Otel yöneticisini aç →",
        priceListLink: "→ Tedavi fiyat listesi",
        priceListHint: "(operasyonel + yapay zeka fiyatlandırması)",
        multilingualNoteTitle: "Tek klinik bilgisi, birçok dil.",
        multilingualNoteBody: "Aşağıdan dilleri etkinleştirin. Markalar, fiyatlar, lojistik ve süreç bilgisi tek yerde kalır — yapay zeka her dilde doğal yanıt verir, her dil için ayrı kurulum gerekmez.",
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
          aiProfile: { title: "YZ nasıl konuşsun?", hint: "Diller, ton ve karşılama — asistanınıza kliniğinizin sesini öğretin." },
          conversionCoordinator: {
            title: "Dönüşüm koordinatörü",
            hint: "Güven odaklı, satış botu değil — ton, CTA, fiyatlandırma ve yasak ifadeler.",
          },
          materials: { title: "Markalar ve malzemeler", hint: "İmplant markaları, laboratuvar, garanti — doğru bilgi için." },
          travel: { title: "Seyahat ve konaklama", hint: "Diş turizmi soruları için partner oteller." },
          logistics: { title: "Saatler ve koordinasyon", hint: "Çalışma saatleri, yanıt süresi, acil iletişim." },
          payment: { title: "Ödeme politikaları", hint: "Depozito, taksit, iade — YZ açıklar, anlaşmazlıkta insan devreye girer." },
          workflow: { title: "Tedavi süreci bilgisi", hint: "Ziyaret süreleri, iyileşme — rehberlik, tanı değil." },
          aiSafety: { title: "Ne zaman insan gerekir?", hint: "YZ tek başına ne yanıtlayabilir, neyi önerebilir, neyi devreder." },
          handoff: { title: "Yükseltme kuralları", hint: "YZ ne zaman koordinatör veya doktoru uyarır." },
          internalNotes: { title: "Klinik hikâyesi (dahili)", hint: "Konumlandırma ve öncelikler — tona yön verir, hastaya aynen gösterilmez." }
        },
        conversion: {
          introTitle: "YZ Tedavi Koordinatörü",
          introBody: "davranış yönetimi (satış botu değil). Dönüşüm Motoru varsayılan olarak açıktır.",
          engineEnabled: "Dönüşüm Motoru etkin",
          recordTimelineEvents: "Dönüşüm zaman çizelgesi olaylarını kaydet",
          safetyHeading: "Güvenlik ifade kategorileri",
          presets: {
            soft_conversion_coordinator: "Yumuşak dönüşüm koordinatörü (varsayılan)",
            luxury_clinic: "Lüks klinik",
            budget_clinic: "Ekonomik klinik",
            dental_tourism: "Diş turizmi",
            implant_focused: "İmplant odaklı",
            cosmetic_dentistry: "Estetik diş hekimliği",
            international_patients: "Uluslararası kullanıcılar",
            consultation_focused: "Konsültasyon odaklı",
          },
          intensity: {
            gentle: "Hafif — bilgilendirici, güven öncelikli",
            balanced: "Dengeli — aktif koordinatör",
            proactive: "Proaktif — dönüşüm odaklı (asla baskıcı değil)",
          },
          ctaStyle: {
            soft: "Yumuşak — isteğe bağlı takip",
            balanced: "Dengeli — ziyaret ve hazırlığı özetle",
            proactive: "Proaktif — net sonraki adım",
          },
          pricingBehavior: {
            educate_then_range: "Önce bilgilendir, sonra aralık ver",
            range_only: "Yalnızca kısa fiyat aralığı",
            defer_to_coordinator: "Koordinatöre yönlendir",
          },
          nextStep: {
            collect_xray: "Röntgen / görüntüleme iste",
            book_consultation: "Konsültasyon planla",
            start_whatsapp: "WhatsApp görüşmesi başlat",
            schedule_visit: "Klinik ziyareti planla",
            collect_user_info: "Kullanıcı bilgisi topla",
            explain_treatment_process: "Tedavi sürecini açıkla",
          },
        },
        sedationAvailable: "Sedasyon mevcut",
        weekendAvailability: "Hafta sonu müsaitlik",
        sameDayTreatment: "Aynı gün tedavi",
        airportTransfer: "Havalimanı transferi",
        depositRequired: "Depozito gerekli",
        installments: "Taksit",
        financing: "Finansman",
        creditCard: "Kredi kartı",
        autonomyIntro: "Yapay zekanın ne kadar bağımsız yanıt verebileceğini seçin. Tıbbi konular her zaman insan gerektirir.",
        autonomyCategory: "Kategori",
        autonomyLevel: "Seviye",
        safetyIntro: "Her zaman insan incelemesi gerekir (tıbbi tavsiye asla otomatik gönderilmez):",
        handoffIntro: "İşaretlendiğinde YZ otomatik yanıtı durdurur ve ekibinizi uyarır.",
        workflowJourneysHint: "Her tedavi için ziyaret süreleri, iyileşme beklentileri ve takip adımlarını yapay zekaya öğretin.",
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
          angryUser: "Kızgın kullanıcı",
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
        langs: { en: "İngilizce", tr: "Türkçe", ru: "Rusça", ka: "Gürcüce", ar: "Arapça", de: "Almanca", fr: "Fransızca" },
        ui: {
          usedByAi: "YZ yanıtlarında kullanılır",
          usedByAiTitle: "Bu bilgi yapay zeka asistanınızı eğitir",
          usedByAiSection: "YZ kullanır",
          seeExample: "Örnek gör",
          aiPrefix: "YZ:"
        },
        visibility: {
          patient_visible: { short: "Kullanıcıya görünür", label: "Kullanıcı mesajlarında görünebilir" },
          ai_reply: { short: "YZ yanıtları", label: "YZ yanıtlarında kullanılır" },
          internal: { short: "Dahili", label: "Yalnızca dahili / operasyonel" }
        },
        options: {
          toneStyle: {
            warm_professional: "Sıcak + profesyonel",
            clinical_concise: "Klinik ve öz",
            friendly_casual: "Samimi ve rahat",
            luxury_premium: "Lüks / premium"
          },
          signatureStyle: {
            name_only: "Yalnızca asistan adı",
            name_clinic: "Ad + klinik",
            none: "İmza yok"
          }
        },
        sectionHelp: {
          aiProfile: {
            intro: "Hangi dillerde yanıt verileceğini ve asistanınızın nasıl konuşacağını ayarlayın. Marka, fiyat ve süreç bilgisi tek yerde kalır — YZ her dilde doğal yanıt verir.",
            aiUsageSummary: "Dil seçimi, karşılama, imza ve kullanıcı iletişim tonu."
          },
          conversionCoordinator: {
            intro: "Güven odaklı yumuşak dönüşüm — ton, CTA, fiyatlandırma ve yasak ifadeler. Satış botu değil; Dönüşüm Motoru koordinatör yanıtlarını yönlendirir.",
            aiUsageSummary: "Koordinatör sohbetlerinde strateji bloğu; isteğe bağlı zaman çizelgesi analitiği.",
          },
          materials: {
            intro: "Kliniğinizin çalıştığı marka ve malzemeler. YZ marka uydurmadan seçenekleri açıklar.",
            aiUsageSummary: "İmplant, zirkonyum, laboratuvar ve garanti hakkında bilgilendirici yanıtlar."
          },
          logistics: {
            intro: "Çalışma saatleri, yanıt süreleri ve pratik klinik koordinasyonu.",
            aiUsageSummary: "Randevu, müsaitlik ve acil durumlarda yönlendirme."
          },
          payment: {
            intro: "Depozito, finansman, iade. YZ politikaları açıklar — istisna vaat etmez.",
            aiUsageSummary: "Ödeme ve politika soruları; iadelerde insana yönlendirir."
          },
          workflow: {
            intro: "Ziyaret süreleri, iyileşme ve tedavi sonrası koordinasyon. Yalnızca operasyonel rehber — tanı değil.",
            aiUsageSummary: "Tedavi süreci, iyileşme, takip ve operasyon sonrası kullanıcı soruları."
          },
          aiSafety: {
            intro: "YZ ne kadar bağımsız yanıt verebilir. Tıbbi konular her zaman insan incelemesi gerektirir.",
            aiUsageSummary: "Konuya göre otomatik yanıt, öneri veya kapalı mod."
          },
          handoff: {
            intro: "YZ ne zaman durmalı ve koordinatörünüzü veya doktorunuzu uyarmalı.",
            aiUsageSummary: "Görüşmede insan devrine geçiş tetikleyicileri."
          },
          internalNotes: {
            intro: "Klinik konumlandırma ve strateji. YZ markanızla uyum sağlar — kullanıcıya aynen gösterilmez.",
            aiUsageSummary: "Ton, öncelikler ve vurgulanacaklar için dahili bağlam."
          },
          travel: {
            intro: "Partner oteller — tıbbi seyahat sorularında YZ en fazla 3 aktif oteli önerebilir.",
            aiUsageSummary: "Konaklama, transfer ve seyahat planlama soruları."
          }
        },
        autonomyLevels: {
          OFF: "Kapalı",
          SUGGEST_ONLY: "Yalnızca öneri",
          AUTO_REPLY: "Otomatik yanıt",
          FULLY_AUTONOMOUS: "Tam özerk"
        },
        fieldHelp: {
          supportedLanguages: {
            label: "Çok dilli YZ desteği",
            helper: "Kullanıcı sohbetlerinde hangi dillerin kullanılacağını seçin. Klinik bilgisi tek yerde kalır — YZ her dilde yanıt verir.",
            aiUsage: "Kullanıcı dili algılama, yanıt dili ve insan personel yönlendirme ipuçları.",
            example: "Birincil İngilizce; diş turizmi için Türkçe, Rusça, Gürcüce."
          },
          displayNameLocalized: {
            label: "Asistan adı (yerelleştirilmiş)",
            helper: "İsteğe bağlı dil bazlı asistan görünen adları. Boş bırakılırsa YZ İngilizceden çevirir.",
            aiUsage: "Kullanıcının dilinde karşılama ve imzalar.",
            example: "en: DentX Care Team · tr: DentX Kullanıcı Destek Ekibi"
          },
          welcomeMessageLocalized: {
            label: "Karşılama mesajı (yerelleştirilmiş)",
            helper: "İsteğe bağlı dil bazlı açılış mesajı şablonları — MVP için zorunlu değil.",
            aiUsage: "İlk temas tonu ve klinik tanıtımı.",
            placeholder: "Her etkin dilde kısa karşılama"
          },
          toneStyle: {
            label: "Ton / üslup",
            helper: "Kullanıcı sohbetleri için genel iletişim tarzı.",
            aiUsage: "Yanıtlarda sıcaklık, resmiyet ve lüks seviyesini belirler.",
            example: "Uluslararası diş turizmi için sıcak + profesyonel."
          },
          signatureStyle: {
            label: "İmza stili",
            helper: "Mesajların sonunda nasıl imzalanacağı.",
            aiUsage: "YZ tarafından üretilen kullanıcı mesajlarına eklenir."
          },
          profileTags: {
            label: "Profil etiketleri",
            helper: "Klinik havanızı tanımlayan kısa etiketler (lüks, hızlı yanıt vb.).",
            aiUsage: "Dahili ton ipuçları — kullanıcıya doğrudan gösterilmez.",
            placeholder: "lüks, samimi, premium, hızlı_yanıt",
            example: "premium, samimi, hızlı_yanıt"
          },
          preset: {
            label: "Klinik ön ayarı",
            helper: "Klinik tipinize göre hazır dönüşüm stili — ton, CTA ve fiyatlandırmayı ayarlar.",
            aiUsage: "Dönüşüm Motoru strateji bloğuna ön ayar kurallarını yükler.",
          },
          coordinatorIntensity: {
            label: "Koordinatör yoğunluğu",
            helper: "YZ'nin güveni koruyarak sonraki adımlara ne kadar aktif yönlendireceği.",
            aiUsage: "Dönüşüm duruşu: hafif (bilgilendirici), dengeli veya proaktif.",
          },
          ctaStyle: {
            label: "Harekete geçirme (CTA) stili",
            helper: "Sonraki adımları (röntgen, konsültasyon, WhatsApp, ziyaret) ne kadar doğrudan önereceği.",
            aiUsage: "Yanıtların kapanış cümleleri ve takip davetleri.",
          },
          pricingBehavior: {
            label: "Fiyatlandırma davranışı",
            helper: "Önce bilgilendirip aralık verme, kısa aralık veya insan koordinatöre yönlendirme.",
            aiUsage: "Maliyet sorularında fiyatla ilgili yanıtları şekillendirir.",
          },
          nextStepPreference: {
            label: "Tercih edilen sonraki adımlar",
            helper: "Uygun olduğunda YZ'nin önceliklendirmesi gereken adımlar (hepsi birden değil).",
            aiUsage: "Koordinatör sohbetlerinde CTA seçimini yönlendirir.",
          },
          forbidden_guarantees: {
            label: "Yasak garanti ifadeleri",
            helper: "YZ'nin asla kullanmaması gereken ifadeler (satır başına bir tane).",
            aiUsage: "Sonuç ve garanti dili için güvenlik filtresi.",
            placeholder: "garantili sonuç\n%100 başarı",
          },
          forbidden_diagnosis: {
            label: "Yasak tanı dili",
            helper: "Engellenecek tanı veya kesinlik ifadeleri.",
            aiUsage: "Yanıtları operasyonel tutar; klinik tanı değil.",
          },
          forbidden_claims: {
            label: "Yasak pazarlama iddiaları",
            helper: "Kaçınılacak abartılı veya karşılaştırmalı iddialar.",
            aiUsage: "Markaya uygun, uyumlu kullanıcı mesajları.",
          },
          forbidden_urgency: {
            label: "Yasak aciliyet baskısı",
            helper: "Engellenecek yüksek baskılı aciliyet ifadeleri.",
            aiUsage: "Baskıcı veya korkuya dayalı dönüşüm taktiklerini önler.",
          },
          implantBrands: {
            label: "İmplant markaları",
            helper: "Rutin kullandığınız markalar. YZ üst düzey karşılaştırma yapar — tıbbi öneri değil.",
            aiUsage: "Marka ve seçenek açıklamaları.",
            placeholder: "Straumann, Nobel, Osstem"
          },
          premiumBrands: {
            label: "Premium markalar",
            helper: "Sunuyorsanız üst segment markalar.",
            aiUsage: "Premium seçenek sorularında üst satış veya karşılaştırma."
          },
          zirconiumTypes: {
            label: "Zirkonyum türleri",
            helper: "Kron/kaplama için kullandığınız malzemeler.",
            aiUsage: "Estetik ve kron malzemesi soruları.",
            placeholder: "E.max, çok katmanlı zirkonya"
          },
          labPartners: {
            label: "Laboratuvar ortakları",
            helper: "Klinik içi veya partner laboratuvarlar — süreç yanıtlarında güven.",
            aiUsage: "Operasyonel süreç açıklamaları."
          },
          warrantyInformation: {
            label: "Garanti politikası",
            helper: "Garanti koşullarının özeti. YZ yasal garanti uydurmaz.",
            aiUsage: "Garanti ve güvence soruları.",
            placeholder: "Yıllık kontrol ile 10 yıl implant garantisi"
          },
          sedationAvailability: {
            label: "Sedasyon mevcut",
            helper: "Kaygılı kullanıcılar için sedasyon sunuluyor mu.",
            aiUsage: "Konfor ve kaygı ile ilgili sorular."
          },
          weekdayHours: {
            label: "Hafta içi saatler",
            helper: "Randevu ve yanıt için normal açılış saatleri.",
            aiUsage: "Randevu ve “ne zaman açıksınız?” soruları.",
            placeholder: "09:00 – 18:00"
          },
          timezone: {
            label: "Klinik saat dilimi",
            helper: "Randevu ve yanıt süreleri için IANA saat dilimi.",
            aiUsage: "Uluslararası kullanıcılar için saat ve yanıt penceresi dönüşümü.",
            placeholder: "Europe/Istanbul"
          },
          averageResponseSlaMinutes: {
            label: "Hedef yanıt süresi (dakika)",
            helper: "YZ devrettiğinde ekibinizin ne kadar sürede yanıt vermesini beklediğiniz. Kullanıcıya gösterilmez.",
            aiUsage: "İnsan yanıtı gecikirse koordinatöre hatırlatma.",
            placeholder: "120"
          },
          emergencyContact: {
            label: "Acil iletişim",
            helper: "Acil durum telefonu veya talimatı. YZ tıbbi tavsiye vermez, acile yönlendirir.",
            aiUsage: "Acil / şiddetli ağrı yönlendirmesi (insan devri ile).",
            placeholder: "+90 … / WhatsApp acil hattı"
          },
          transportationNotes: {
            label: "Ulaşım notları",
            helper: "Havalimanı karşılama, VIP transfer, servis detayları.",
            aiUsage: "Seyahat ve varış koordinasyonu.",
            example: "Tedavi kullanıcıları için Pzt–Cmt ücretsiz havalimanı karşılama; istek üzerine VIP transfer."
          },
          refundPolicy: {
            label: "İade politikası",
            helper: "Standart iade kuralları. YZ özetler — anlaşmazlıklarda insana yönlendirir.",
            aiUsage: "İade soruları (çatışmada devir).",
            placeholder: "Tedaviden 14+ gün önce iptalde depozito iade edilir"
          },
          cancellationPolicy: {
            label: "İptal politikası",
            helper: "Randevu veya paket iptal koşulları.",
            aiUsage: "Randevu ve iptal soruları."
          },
          positioningNotes: {
            label: "Konumlandırma maddeleri",
            helper: "Kliniği nasıl konumlandırmak istediğiniz (estetik, muhafazakâr planlama, tipik kalış). Satır başına bir madde.",
            aiUsage: "YZ vurgu ve öneri tarzını şekillendirir — aynen alıntılanmaz.",
            example: "Doğal estetiğe odaklanırız\nÇoğu uluslararası kullanıcı 5–7 gün kalır"
          },
          freeformNotes: {
            label: "Ek dahili notlar",
            helper: "YZ kullanıcı koordine ederken ekibinizin bilmesi gereken diğer bilgiler.",
            aiUsage: "Kullanıcı koordinasyonu için ek bağlam."
          },
          protocol_postOpNotes: {
            label: "Operasyon sonrası koordinasyon notları",
            helper: "Tedavi sonrası kullanıcıları kliniğinizin nasıl yönlendirdiğini açıklayın. YZ iyileşme, takip, şişlik, beslenme ve kontrol sorularında kullanabilir.",
            aiUsage: "Operasyon sonrası koordinasyon yanıtları — doktor tavsiyesi yerine geçmez.",
            placeholder: "İmplant cerrahisinden sonra 48 saat sert gıdalardan kaçınılır. İlk 2–3 gün hafif şişlik normaldir.",
            example: "Yumuşak diyet 48 saat, ilk gün buz, uçuş öncesi kontrol, 3. gün WhatsApp takibi."
          }
        }
      },

      travel: {
        pageTitle: "Seyahat ve Konaklama — Clinifly Admin",
        breadcrumbSettings: "Klinik Ayarları",
        breadcrumbCurrent: "Seyahat ve Konaklama",
        title: "Seyahat ve Konaklama",
        lead: "Partner otelleriniz, yapay zekanın konaklama ve seyahat sorularında önerebileceği seçenekleri belirler — görüşme başına en fazla 3 aktif tesis kullanılır.",
        partnerHotels: "Partner oteller",
        addHotel: "+ Otel ekle",
        editHotel: "Oteli düzenle",
        emptyList: "Henüz partner otel yok. YZ'nin konaklama önerebilmesi için ilk tesisinizi ekleyin.",
        loading: "Yükleniyor…",
        futureNote: "Yakında: havalimanı transferleri, şoförler, tercümanlar, apartmanlar — mimari hazır, henüz etkin değil.",
        saveHotel: "Oteli kaydet",
        cancel: "İptal",
        delete: "Sil",
        edit: "Düzenle",
        deleteConfirm: "Bu otel silinsin mi?",
        openMaps: "Haritayı aç",
        minFromClinic: "dk — klinikten",
        chipPreferred: "Tercih edilen",
        chipActive: "Aktif",
        chipInactive: "Pasif",
        chipTransfer: "Transfer",
        chipBreakfast: "Kahvaltı",
        fieldName: "Ad *",
        fieldPrice: "Fiyat aralığı (yaklaşık)",
        fieldDistance: "Mesafe (klinikten dakika)",
        fieldSort: "Sıralama",
        fieldAddress: "Adres",
        fieldMaps: "Google Maps URL",
        fieldBooking: "Rezervasyon URL (isteğe bağlı)",
        fieldLangs: "Desteklenen diller",
        fieldDiscount: "Klinik indirim notları",
        fieldNotes: "Dahili notlar",
        checkTransfer: "Transfer dahil / ayarlanabilir",
        checkBreakfast: "Kahvaltı dahil",
        checkPreferred: "Tercih edilen partner",
        checkActive: "Aktif (YZ'ye görünür)",
        phName: "Radisson Blu Tiflis",
        phPrice: "120–180 USD / gece",
        phDistance: "8",
        phAddress: "Rose Revolution Square…",
        phMaps: "https://maps.google.com/…",
        phLangs: "en, ru, tr",
        phDiscount: "%10 klinik partner oranı",
        phNotes: "Yalnızca koordinatör notları",
        errLoad: "Yükleme başarısız",
        errDelete: "Silme başarısız",
        errSave: "Kaydetme başarısız"
      },

      treatmentWorkflows: {
        pageTitle: "Tedavi İş Akışları — Clinifly Admin",
        breadcrumbSettings: "Klinik Ayarları",
        breadcrumbAiTraining: "YZ Eğitimi",
        breadcrumbCurrent: "Tedavi iş akışları",
        title: "Tedavi iş akışları",
        lead: "Yapay zekaya kliniğinizde tedavi süreçlerinin genelde nasıl işlediğini öğretin — ziyaret zamanlaması, iyileşme beklentileri ve takip adımları dahil.",
        intro: "Her tedavi türü için tipik ziyaret sayısı, kalış süresi ve operasyon sonrası rehberliği ekleyin. YZ bunu kullanıcılara kliniğinizin rutinini anlatmak için kullanır — tıbbi tanı veya reçete değildir.",
        panelTitle: "Tedavi iş akışlarınız",
        addWorkflow: "+ İş akışı ekle",
        editWorkflow: "İş akışını düzenle",
        addWorkflowForm: "İş akışı ekle",
        emptyList: "Henüz iş akışı yok. İmplant, kaplama veya diğer tedaviler için YZ'nin kliniğinizin rutinini bilmesini sağlayın.",
        loading: "Yükleniyor…",
        futureNote: "Yakında: aşama adımları, iyileşme kilometre taşları ve koordinatör kontrol listeleri.",
        fieldTreatment: "Tedavi türü *",
        fieldVisits: "Tipik ziyaret sayısı",
        fieldSort: "Sıra",
        fieldLangs: "Diller",
        checkXray: "Genelde röntgen / görüntüleme gerekir",
        checkTemp: "Geçici diş mümkün",
        checkActive: "Kullanıcı görüşmelerinde kullan",
        saveWorkflow: "İş akışını kaydet",
        cancel: "İptal",
        delete: "Sil",
        edit: "Düzenle",
        deleteConfirm: "Bu iş akışı silinsin mi?",
        chipActive: "Aktif",
        chipInactive: "Pasif",
        chipXray: "Röntgen",
        chipTemp: "Geçici diş",
        noTimeline: "Zaman çizelgesi henüz ayarlanmadı",
        visits: "ziyaret",
        secondVisit: "2. ziyaret:",
        setupPreparing: "Tedavi iş akışları hazırlanıyor. Bu sayfayı inceleyebilirsiniz; kaydetme kurulum tamamlandığında açılacaktır. Mesaj devam ederse Clinifly desteğine yazın.",
        setupNotReady: "YZ iş akışı kurulumu henüz tam hazır değil. Lütfen biraz sonra yenileyin veya destek ile iletişime geçin.",
        errLoad: "İş akışları yüklenemedi. Lütfen yenileyin.",
        errSave: "Şu anda kaydedilemedi. Lütfen tekrar deneyin.",
        errDelete: "Silinemedi. Lütfen tekrar deneyin.",
        errReorder: "Sıralama kaydedilemedi. Lütfen tekrar deneyin.",
        customTypeOption: "Diğer tedavi…",
        customTypePrompt: "Tedavi adı (ör. sinüs kaldırma):"
      },

      patientInvite: {
        dashboardTitle: "Kullanıcı Daveti",
        quickTitle: "Kullanıcı davet et",
        quickHint: "Kullanıcılarınız klinik kodu girmeden QR veya link ile otomatik kayıt olur.",
        pageTitle: "Kullanıcı Daveti",
        pageSubtitle: "Davet linki veya QR kodunu paylaşın. Yeni kullanıcılar kayıt sonrası kliniğinize otomatik bağlanır.",
        copyLink: "Davet Linkini Kopyala",
        showQr: "QR Kodu Göster",
        downloadQr: "QR İndir",
        printPoster: "Poster Yazdır",
        invitationUrl: "Davet URL",
        modalTitle: "Kullanıcı daveti",
        clinicLabel: "Klinik",
        copied: "Kopyalandı!",
        allowPopups: "Poster için açılır pencereye izin verin.",
        posterTagline: "Clinifly'de kliniğimize katılmak için tarayın",
        openFullPage: "Davet sayfasını aç",
        codeHint: "Klinik kodu: {code}",
        codeHintSuffix: "QR tarayan kullanıcılar kayıt sonrası kliniğinize bağlanır.",
        qrLoadError: "QR yüklenemedi. Tekrar deneyin veya davet linkini kopyalayın."
      },

      // Patients (admin-patients.html)
      patients: {
        title: "Clinifly Admin – Users",
        registeredPatients: "Kayıtlı Kullanıcılar",
        searchPlaceholder: "Ara: isim / telefon / patientId / clinicCode",
        filterAll: "Tümü",
        clearFilters: "Temizle",
        refresh: "Yenile",
        loading: "Yükleniyor...",
        noResults: "Sonuç yok",
        selectedPatient: "Seçili Kullanıcı: {name}",
        patientId: "User ID: {id}",
        copyId: "Copy ID",
        copyIdSuccess: "✅ Kullanıcı ID kopyalandı",
        clear: "Clear",
        travel: "Seyahat",
        treatment: "Tedavi",
        health: "Sağlık",
        chat: "Chat",
        files: "📁 Dosyalar",
        approve: "Onayla",
        approveConfirm: "Kullanıcıyı onaylamak istediğinize emin misiniz? ({patientId})",
        approveSuccess: "✅ Kullanıcı onaylandı",
        addPatient: "➕ Kullanıcı ekle",
        addPatientTitle: "Yeni kullanıcı ekle",
        firstName: "Ad *",
        lastName: "Soyad *",
        email: "E-posta",
        dateOfBirth: "Doğum tarihi",
        address: "Adres",
        notes: "Notlar",
        cancel: "İptal",
        add: "Kullanıcı ekle",
        addSuccess: "✅ Kullanıcı başarıyla eklendi",
        addError: "❌ Kullanıcı eklenemedi",
        assignDoctorLabel: "Doktor ata:",
        assignButton: "Ata",
        selectDoctorPlaceholder: "Doktor seçin",
        noDoctorAssigned: "Atanmış doktor yok",
        before: "Önce",
        after: "Sonra",
        phone: "Telefon",
        status: {
          PENDING: "Beklemede",
          APPROVED: "Onaylandı"
        },
        errors: {
          noToken: "⚠️ Admin token bulunamadı. Lütfen önce giriş yapın.",
          unauthorized: "❌ Yetkilendirme hatası. Lütfen tekrar giriş yapın.",
          loadFailed: "❌ Kullanıcı listesi yüklenemedi: {error}",
          approveFailed: "❌ Onaylama hatası: {error}",
          patientLimitReached: "⚠️ Aktif kullanıcı limitinize ulaştınız. Yeni kullanıcı eklemek için planınızı yükseltebilirsiniz.",
          patientLimitReachedTitle: "Kullanıcı Limiti Doldu"
        },
        limits: {
          title: "Aktif Kullanıcı Limiti",
          message: "Mevcut planınızda {current}/{limit} aktif kullanıcı bulunuyor.",
          upgradeMessage: "Yeni kullanıcı eklemek için planınızı yükseltebilirsiniz.",
          upgradeButton: "Planı Yükselt",
          continueButton: "Mevcut Kullanıcılarla Devam Et"
        }
      },
      
      // Referrals (admin-referrals.html)
      referrals: {
        title: "🎁 Clinifly Admin – Referrals",
        referrals: "Referrals",
        filterAll: "Tümü",
        refresh: "↻ Yenile",
        loading: "Yükleniyor...",
        noReferrals: "Referral bulunamadı.",
        inviter: "Davet eden",
        invited: "Davet edilen",
        createdAt: "Oluşturulma",
        inviterDiscount: "Inviter İndirim",
        invitedDiscount: "Invited İndirim",
        discount: "İndirim",
        approve: "Onayla",
        reject: "Reddet",
        approveConfirm: "Bu referral'ı onaylamak istediğinize emin misiniz?",
        rejectConfirm: "Bu referral'ı reddetmek istediğinize emin misiniz?",
        approved: "Referral onaylandı ✅",
        rejected: "Referral reddedildi ✅",
        found: "{count} referral bulundu.",
        activityPageTitle: "🎁 Referral aktivitesi",
        statTotalReferrers: "Toplam davet eden",
        statInvitedUtcMonth: "Bu UTC ayında davet",
        statInvitedUtcMonthTitle: "Plan ve kullanım → Referral davetleri (faturalama / SaaS) ile aynı",
        statTotalInvitedAllTime: "Toplam davet (tüm zamanlar)",
        statRegistered: "Kayıtlı",
        statTreated: "Tedavi gördü",
        statPending: "Bekleyen onay",
        pendingSectionTitle: "Onay bekleyen referral'lar",
        thStatus: "Durum",
        thCode: "Kod",
        thDate: "Tarih",
        thActions: "İşlem",
        summaryTitle: "Davet eden özeti",
        filterAllStatuses: "Tüm durumlar",
        filterRegisteredOpt: "Kayıtlı",
        filterTreatedOpt: "Tedavi gördü",
        filterRewardedOpt: "Ödüllendirildi",
        thReferrer: "Davet eden",
        thInvitedCount: "Davet",
        thRegisteredCount: "Kayıtlı",
        thTreatedCount: "Tedavi",
        thInvitedPatients: "Davet edilen kullanıcılar",
        loadingMain: "Yükleniyor…",
        sessionExpired: "Oturum süresi doldu. Lütfen tekrar giriş yapın.",
        errorLoad: "Hata: {message}",
        emptyPending: "Bekleyen onay yok.",
        emptyActivity: "Referral kaydı bulunamadı.",
        statusBadgePending: "Onay bekliyor",
        statusShortInvited: "Davetli",
        statusShortRegistered: "Kayıtlı",
        statusShortTreated: "Tedavi gördü",
        statusShortRewarded: "Ödüllendirildi",
        registrationRate: "%{percent} kayıt oranı",
        morePatients: "+{count} daha",
        unknownReferrer: "Bilinmiyor",
        requestFailed: "İstek başarısız",
        discountErrorHint: "Klinik ayarlarında referral indirim yüzdeleri tanımlanmalı (Clinic Settings).",
        defaultDiscounts: "Varsayılan indirimler: Davet Eden %{inviter}%, Davet Edilen %{invited}%",
        defaultDiscountsRequired: "⚠️ Varsayılan indirim yüzdeleri Clinic Settings sayfasında girilmelidir.",
        status: {
          PENDING: "Beklemede",
          APPROVED: "Onaylandı",
          REJECTED: "Reddedildi"
        },
        errors: {
          noToken: "⚠️ Admin token bulunamadı. Lütfen admin olarak giriş yapın.",
          invalidToken: "❌ Admin token geçersiz veya süresi dolmuş. Lütfen admin token girin.",
          loadFailed: "Referrals yüklenemedi.",
          approveFailed: "Onaylama hatası: {error}",
          rejectFailed: "Reddetme hatası: {error}"
        }
      },
      marketplaceProfile: {
        title: "Clinifly Admin – Dizin Profili",
        pageTitle: "Kullanıcı Dizin Profili",
        subtitle: "Kliniğinizin Clinifly kullanıcı dizinindeki görünümünü yönetin. İtibar verileri klinik tarafından girilir — Google ve Trustpilot bilgilerini elle ekleyin. Onaylı, öne çıkan ve sponsor rozetleri Clinifly tarafından atanır.",
        loading: "Profil yükleniyor…",
        loadFailed: "Yüklenemedi",
        saving: "Kaydediliyor…",
        saved: "Profil kaydedildi.",
        saveFailed: "Kaydetme başarısız",
        saveBtn: "Profili kaydet",
        reloadBtn: "Yeniden yükle",
        sectionCompletion: "Profil tamamlama",
        sectionCompletionHint: "Dolu profiller kullanıcıların karşılaştırma yapmasına ve güvenmesine yardımcı olur.",
        completed: "Tamamlanan",
        missing: "Eksik",
        nothingYet: "Henüz yok",
        allDone: "Tamamlandı",
        publishTitle: "Kullanıcı dizinine yayınla",
        publishHint: "Gerekli: logo, açıklama, ülke, ≥1 uzmanlık, ≥1 dil, web sitesi veya sosyal bağlantı",
        sectionBadges: "Platform rozetleri",
        sectionBadgesHint: "Yalnızca Clinifly — değişiklik için Clinifly ile iletişime geçin.",
        sectionReputation: "İtibar ve Güven",
        sectionReputationHint: "Klinik tarafından yönetilir — Google İşletme, Facebook Sayfası ve Trustpilot profillerinizden kopyalayın.",
        sectionGoogleReviews: "Google Yorumları",
        sectionFacebookReviews: "Facebook Yorumları",
        sectionTrustpilotReviews: "Trustpilot Yorumları",
        facebookReviewsHelp: "Facebook Sayfanızı açın ve sayfa URL'sini kopyalayın. Facebook'taki öneri puanınızı ve öneri sayınızı girin.",
        reputationPreviewLabel: "Kullanıcı tarafında görünüm",
        reputationPreviewEmpty: "Puan girildiğinde önizleme burada görünür.",
        sectionSocial: "Sosyal ve Web",
        sectionClinicInfo: "Klinik Bilgileri",
        sectionMedia: "Medya",
        sectionMediaHint: "Herkese açık görsel/video URL'leri yapıştırın (galerilerde satır başına bir URL).",
        locationHint: "Ayarlar ile aynı konum → klinik arama filtrelerinde kullanılır.",
        listedButMissing: "Yayında ancak eksik gereksinimler: {items}",
        toPublishComplete: "Yayınlamak için tamamlayın: {items}",
        fields: {
          googleBusinessUrl: "Google İşletme URL",
          googleRating: "Google Puanı (0–5)",
          googleReviewCount: "Google Yorum Sayısı",
          facebookPageUrl: "Facebook Sayfa URL",
          facebookRecommendationScore: "Facebook Öneri Puanı",
          facebookRecommendationCount: "Facebook Yorum / Öneri Sayısı",
          trustpilotUrl: "Trustpilot URL",
          trustpilotRating: "Trustpilot Puanı (0–5)",
          trustpilotReviewCount: "Trustpilot Yorum Sayısı",
          yearsInOperation: "Faaliyet Yılı",
          intlPatients: "Yıllık Uluslararası Kullanıcı",
          website: "Web Sitesi",
          facebook: "Facebook",
          instagram: "Instagram",
          tiktok: "TikTok",
          youtube: "YouTube",
          linkedin: "LinkedIn",
          googleMaps: "Google Maps URL",
          shortDescription: "Kısa Açıklama",
          aboutText: "Hakkında (isteğe bağlı uzun metin)",
          country: "Ülke",
          city: "Şehir",
          languages: "Diller (virgülle ayırın, örn. English, Turkish, Russian)",
          specialties: "Uzmanlıklar (virgülle ayırın, örn. Implantology, Aesthetic Dentistry)",
          logoUrl: "Logo URL",
          coverPhotoUrl: "Kapak Fotoğrafı URL",
          galleryPhotos: "Galeri Görselleri (satır başına bir URL)",
          beforeAfter: "Önce / Sonra Görselleri (satır başına bir URL)",
          videoUrls: "Video URL'leri (satır başına bir tane)",
        },
        placeholders: {
          googleBusinessUrl: "https://g.page/…",
          facebookPageUrl: "https://www.facebook.com/kliniginiz",
          facebookRecommendationScore: "96",
          facebookRecommendationCount: "145",
          trustpilotUrl: "https://www.trustpilot.com/review/…",
          shortDescription: "Arama kartları için tek satır",
          aboutText: "Profil sayfasındaki uzun hakkında bölümü",
          city: "Tiflis, Antalya, İstanbul…",
          galleryPhotos: "https://…",
          beforeAfter: "https://…",
          videoUrls: "https://youtube.com/…",
        },
        checklist: {
          logo: "Logo",
          description: "Açıklama",
          website: "Web sitesi",
          googleRating: "Google puanı",
          languages: "Diller",
          specialties: "Uzmanlıklar",
          clinicPhotos: "Klinik fotoğrafları",
          video: "Video",
          doctorProfiles: "Doktor profilleri",
          coverPhoto: "Kapak fotoğrafı",
          country: "Ülke",
          city: "Şehir",
          specialty: "En az 1 uzmanlık",
          language: "En az 1 dil",
          websiteOrSocial: "Web sitesi veya sosyal medya bağlantısı",
        },
        badges: {
          verified: "Onaylı",
          featured: "Öne çıkan",
          placement: "Yerleşim",
          featuredUntil: "Öne çıkarma bitiş",
          yes: "Evet",
          no: "Hayır",
        },
        tiers: {
          standard: "Standart",
          featured: "Öne çıkan",
          sponsored: "Sponsorlu",
        },
        countries: {
          "": "Ülke seçin",
          GE: "Gürcistan",
          TR: "Türkiye",
          GB: "Birleşik Krallık",
          DE: "Almanya",
          US: "Amerika Birleşik Devletleri",
          AE: "Birleşik Arap Emirlikleri",
          AZ: "Azerbaycan",
          AM: "Ermenistan",
          RU: "Rusya",
          UA: "Ukrayna",
          FR: "Fransa",
          IT: "İtalya",
          ES: "İspanya",
          NL: "Hollanda",
          SA: "Suudi Arabistan",
          IL: "İsrail",
        },
      },
      successCenter: {
        title: "Clinifly Admin – Başarı Merkezi",
        pageTitle: "Klinik Başarı Merkezi",
        subtitle: "Kurulumu tamamlayarak görünürlüğünüzü artırın ve daha fazla kullanıcı talebi alın. Aşağıdaki önerileri takip edin — ekibinizde bir başarı yöneticisi gibi.",
        loading: "Başarı planınız yükleniyor…",
        loadFailed: "Yüklenemedi",
        profileCompletion: "Profil",
        completionHeading: "Profil Tamamlama",
        completionHint: "{done} / {total} alan tamamlandı",
        sectionRecommendations: "Akıllı Öneriler",
        sectionRecommendationsHint: "Eksik alanlara göre kişiselleştirilmiş adımlar.",
        sectionGuidance: "Clinifly'den Mesajlar",
        sectionGuidanceHint: "Ekibimizden kurulum rehberliği.",
        sectionGuidanceUnreadHint: "Okunmamış mesajınız var — lütfen aşağıdaki rehberliği inceleyin.",
        newMessage: "Yeni mesaj",
        sectionCampaign: "Onboarding Yol Haritası",
        sectionCampaignHint: "Yakında: otomatik kurulum kampanyaları (Gün 1 logo, Gün 3 Google yorumları…).",
        whyItMatters: "Neden önemli",
        allRecommendationsDone: "Harika! Profiliniz tamamlandı — kullanıcı taleplerine hazırsınız.",
        noGuidanceYet: "Henüz rehberlik mesajı yok.",
        markRead: "Okundu",
        items: {
          logo: "Logo",
          description: "Açıklama",
          doctors: "Doktorlar",
          photos: "Fotoğraflar",
          googleReviews: "Google Yorumları",
          facebookReviews: "Facebook Yorumları",
          socialLinks: "Sosyal Bağlantılar",
          languages: "Diller",
          aiSetup: "AI Kurulumu",
        },
        readiness: {
          ready: "Taleplere hazır",
          almost: "Neredeyse tamam",
          started: "Başlangıç aşamasında",
          needsSetup: "Kurulum gerekli",
        },
        campaign: {
          dayLabel: "Gün {day}",
          completed: "Tamamlandı",
          due: "Şimdi yapın",
          upcoming: "Yakında",
          scheduled: "Planlandı",
        },
      },
      helpCenter: {
        pageTitle: "Clinifly ile Başlarken",
        subtitle: "Klinik kurulumu, profil tamamlama, doktor ve kullanıcı bağlantısı, yapay zeka ve daha fazlası için adım adım rehberler. Teknik jargon yok — klinik sahipleri için yazıldı.",
        searchPlaceholder: "Yardım makalelerinde ara…",
        searchNoResults: "Aramanızla eşleşen makale bulunamadı. Farklı kelimeler deneyin veya bölümlere göz atın.",
        checklistTitle: "Hızlı kurulum kontrol listesi",
        checklistHint: "Kullanıcı almaya en hızlı başlamak için bu sırayı izleyin.",
        topicsTitle: "Konular",
        showAll: "Tüm konuları göster",
        supportText: "Hâlâ takıldınız mı?",
        videoLink: "Eğitim videolarını izleyin",
        whatLabel: "Bu nedir?",
        whyLabel: "Neden kullanmalıyım?",
        howLabel: "Nasıl kurarım?",
        tipsLabel: "İpuçları",
        openPage: "İlgili sayfayı aç",
        screenshotCaption: "Örnek ekran — admin paneliniz biraz farklı görünebilir.",
        dashboardBannerTitle: "Clinifly ile Başlarken",
        dashboardBannerDesc: "Klinik profili, doktorlar, kullanıcılar, yapay zeka ve daha fazlası için kurulum rehberleri — klinik sahipleri için yazıldı.",
        dashboardBannerBtn: "Yardım Merkezi →",
        settingsBanner: "Klinik kurulumu, yapay zeka veya referanslar hakkında yardım mı lazım? Adım adım rehberler için Yardım Merkezi'ni ziyaret edin.",
        openLink: "Yardım Merkezi →",
        profileGuideLink: "📖 Halka açık profilinizi tamamlayın — adım adım rehber",
        googleGuideLink: "Google Yorumları rehberi",
        checklist: {
          register: "Klinik kaydı",
          settings: "Klinik bilgileri (Ayarlar)",
          aiTraining: "AI Eğitim Merkezi",
          prices: "Tedavi fiyat listesi",
          directory: "Dizin profili",
          doctors: "Doktor onayı",
          leadInbox: "Lead gelen kutusu ataması",
          whatsapp: "WhatsApp bağlantısı",
          invitePatients: "Kullanıcı davet linki",
        },
        sections: {
          "create-clinic": { title: "Klinik Oluşturun", subtitle: "Hesap oluşturma, onay ve bilgi güncelleme" },
          "connect-doctors": { title: "Doktor Bağlayın", subtitle: "Davet, kayıt, onay ve roller" },
          "add-patients": { title: "Kullanıcı Ekleyin", subtitle: "Katılım, onay, davet ve doktor ataması" },
          "public-profile": { title: "Halka Açık Profilinizi Tamamlayın", subtitle: "Logo, açıklama, fotoğraflar, uzmanlıklar ve diller" },
          "google-reviews": { title: "Google Yorumları", subtitle: "Google Business profilinizi Clinifly'a ekleyin" },
          "social-media": { title: "Sosyal Medya Bağlantıları", subtitle: "Web sitesi, Instagram, Facebook ve daha fazlası" },
          "ai-assistant": { title: "Yapay Zeka Asistanı", subtitle: "AI'yi etkinleştirin, WhatsApp ve Messenger" },
          "international-patients": { title: "Uluslararası Kullanıcılar", subtitle: "Keşif, çok dilli iletişim ve tedavi talepleri" },
          "referral-system": { title: "Referans Sistemi", subtitle: "Arkadaş davetleri ve klinik faydaları" },
          faq: { title: "Sık Sorulan Sorular", subtitle: "Hızlı cevaplar" },
        },
      },
      timeline: {
        tooth: "Diş",
        procedure: "İşlem",
        status: "Durum"
      },
      date: {
        monthsShort: ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"],
        weekdays: ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"]
      },
      files: {
        pageTitle: "Admin – Kullanıcı Dosyaları",
        title: "📁 Kullanıcı Dosyaları",
        selectPatient: "Kullanıcı:",
        selectPlaceholder: "Kullanıcı seçin...",
        filterAll: "Tümü",
        filterPhoto: "📸 Fotoğraf",
        filterXray: "🦷 Röntgen",
        filterPdf: "📄 PDF",
        filterChat: "💬 Chat",
        upload: "Yükle",
        empty: "Dosya bulunamadı.",
        selectToView: "Dosyaları görmek için kullanıcı seçin.",
        badgeImage: "Fotoğraf",
        badgeXray: "Röntgen",
        badgePdf: "PDF",
        badgeFile: "Dosya",
        badgeChat: "Chat",
        download: "İndir"
      },
      doctorListV2: {
        pageTitle: "👨‍⚕️ Doktorlar",
        documentTitle: "Doktorlar - Clinifly Admin",
        statPending: "Bekleyen",
        statApproved: "Onaylı",
        statRejected: "Reddedilen",
        statTotal: "Toplam",
        searchPlaceholder: "Ad, email veya telefon ara...",
        filterAll: "Tüm Durumlar",
        filterOptionPending: "Bekleyen",
        filterOptionApproved: "Onaylanan",
        filterOptionActive: "Aktif",
        filterOptionRejected: "Reddedilen",
        refresh: "↺ Yenile",
        loading: "Yükleniyor...",
        empty: "Henüz doktor kaydı bulunmuyor.",
        errorHttp: "HTTP {status}",
        errorLoad: "Yüklenemedi",
        sectionProfessional: "Mesleki",
        labelExperience: "Deneyim",
        labelUniversity: "Üniversite",
        labelGraduation: "Mezuniyet",
        labelProfile: "Profil",
        labelBio: "Bio",
        profilePublic: "🌐 Açık",
        profilePrivate: "🔒 Gizli",
        sectionSpecialty: "Uzmanlık",
        sectionLanguages: "Diller",
        sectionProcedures: "Prosedürler",
        notSpecified: "Belirtilmedi",
        yearsCount: "{years} yıl",
        dash: "—",
        status: {
          PENDING: "Bekleyen",
          APPROVED: "Onaylı",
          ACTIVE: "Aktif",
          REJECTED: "Reddedildi"
        },
        btnApprove: "✅ Onayla",
        btnReject: "❌ Reddet",
        confirmApprove: "Bu doktoru onaylamak istediğinizden emin misiniz?",
        confirmReject: "Bu başvuruyu reddetmek istediğinizden emin misiniz?",
        approvedAlert: "✅ Doktor onaylandı!",
        rejectedAlert: "Başvuru reddedildi.",
        errorGeneric: "Hata"
      },
      chat: {
        documentTitle: "Sohbet - Clinifly Admin",
        pageHeading: "💬 Clinifly Admin – Sohbet",
        title: "Mesajlar",
        patientsHeading: "Kullanıcılar",
        loading: "Yükleniyor...",
        selectPatient: "Bir kullanıcı seçin",
        noPatients: "Henüz kullanıcı yok",
        unnamed: "İsimsiz",
        placeholder: "Mesaj yazın...",
        send: "Gönder",
        sending: "Gönderiliyor...",
        noMessages: "Henüz mesaj yok",
        newMessage: "Yeni mesaj",
        youJoined: "Sohbete katıldınız",
        photo: "Fotoğraf",
        file: "Dosya",
        photoFile: "📷 Foto",
        fileAttach: "📎 Dosya",
        download: "İndir",
        uploadHelp: "Desteklenen formatlar: JPG, PNG, HEIC (max 10MB) • PDF/DOC/DOCX/TXT/XLS/XLSX (max 20MB) • ZIP (max 50MB)",
        sentOk: "✓ Gönderildi",
        uploadError: "✗ Hata",
        errNoToken: "❌ Admin token bulunamadı. Lütfen önce giriş yapın.",
        errTokenList: "Admin token gerekli",
        errAuth: "❌ Yetkilendirme hatası. Lütfen tekrar giriş yapın.",
        errAuthShort: "❌ Yetkilendirme hatası",
        errUnknown: "Bilinmeyen hata",
        errLoadList: "❌ Kullanıcı listesi yüklenemedi: {message}",
        errLoadMessages: "Mesajlar yüklenemedi",
        errLoadMessagesFull: "❌ Mesajlar yüklenemedi: {message}",
        errSelectFirst: "❌ Lütfen önce kullanıcı seçin",
        errNoTokenSend: "❌ Admin token bulunamadı",
        errSend: "Mesaj gönderilemedi",
        errSendFull: "❌ Mesaj gönderilemedi: {message}",
        errFileUpload: "❌ Dosya gönderilemedi: {message}",
        errSession: "❌ Oturum süreniz dolmuş. Lütfen sayfayı yenileyip tekrar giriş yapın.",
        errForbidden: "❌ Bu dosya tipi desteklenmiyor: {ext}. RAR ve çalıştırılabilir dosyalar yasaktır.",
        errMime: "❌ Dosya tipi belirlenemedi. Lütfen farklı bir dosya deneyin.",
        errImageFmt: "❌ Desteklenen formatlar: JPG, PNG, HEIC – Max 10MB",
        errDocFmt: "❌ Desteklenen formatlar: PDF, DOC/DOCX, TXT, XLS/XLSX, ZIP",
        errPhotoSize: "❌ Fotoğraf boyutu 10MB'dan küçük olmalıdır.",
        errZipSize: "❌ ZIP dosyası 50MB'dan küçük olmalıdır.",
        errDocSize: "❌ Doküman 20MB'dan küçük olmalıdır.",
        errSelectPatient: "❌ Lütfen önce bir kullanıcı seçin",
        before: "Önce",
        after: "Sonra",
        doctorReview: "👨‍⚕️ Doktor incelemesi",
        defaultClinic: "Klinik",
        defaultPhoto: "Fotoğraf",
        defaultFile: "Dosya",
        navClinicSettings: "Klinik Ayarları",
        patientAssignedBanner: "Bu kullanıcı Dr. {doctorName}'e atandı",
      },
      leads: {
        documentTitle: "Lead yönetimi — Clinifly Admin",
        pageTitle: "Lead gelen kutusu",
        subtitle:
          "Her lead için tek bir birincil sorumlu doktor seçilir (primary responder). Klinik ekibi diğer mesajlar ekranından görünürlüğü korur.",
        backDashboard: "← Panel",
        refreshList: "Listeyi yenile",
        statusLoading: "Yükleniyor…",
        statusUnassigned: "{count} kayıt",
        thPatient: "Kullanıcı",
        thContact: "İletişim",
        thPreview: "Son mesaj",
        thAssign: "Doktor ata",
        thPrimary: "Birincil doktor",
        thLastActivity: "Son aktivite",
        thStatus: "Durum",
        thActions: "İşlemler",
        empty: "Lead kaydı yok.",
        selectDoctor: "Doktor seçin…",
        assign: "Ata",
        reassign: "Yeniden ata",
        unassign: "Atamayı kaldır",
        openChat: "Mesajları aç",
        badgeUnassigned: "Atanmadı",
        badgePrimarySet: "Sorumlu atanmış",
        primaryNone: "—",
        confirmUnassign: "Birincil doktor atamasını kaldırmak istiyor musunuz?",
        successUnassigned: "Atama kaldırıldı.",
        errChooseDoctor: "Önce bir doktor seçin.",
        successAssigned: "Başarıyla atandı.",
        errLoad: "Yükleme hatası",
        showAssignedToggle: "Atanmışları da göster",
        assignedBadgePrefix: "Dr.",
        assignedOk: "Atandı:",
        assignDisabledHint: "Bu lead zaten bir doktora atanmış.",
        autoAssignAll: "Tüm atanmamışları otomatik ata",
        autoAssignSelected: "Seçilenleri otomatik ata",
        autoAssignRunning: "Otomatik atama çalışıyor…",
        autoAssignDone: "Atanan: {assigned}, atlanan: {skipped}, başarısız: {failed}.",
        autoAssignDistributionPrefix: "Dağılım:",
        autoAssignPartialFail: "Bazı atamalar başarısız:",
        autoAssignAllConfirm: "Bu klinikteki tüm atanmamış lead'leri dengeli dağıtımla otomatik atamak istiyor musunuz?",
        autoAssignNoneSelected: "En az bir atanmamış lead satırı seçin.",
        selectAllUnassignedTitle: "Bu sayfadaki atanmamış satırların tümünü seç",
        leadRoutingSectionTitle: "Yeni lead yönlendirme",
        leadRoutingHelp:
          "Yalnızca yeni oluşturulan lead iş parçacıkları için geçerlidir. Mevcut iş parçacıklarını veya el ile atamayı değiştirmez.",
        leadRoutingEnable: "Yeni leadler için otomatik birincil atama açık",
        leadRoutingMode: "Yönlendirme modu",
        leadRoutingModeManual: "Yalnızca el ile — atanmadan kalsın",
        leadRoutingModeFixed: "Sabit doktor",
        leadRoutingModeRoundRobin: "Round robin (uygun doktorlar)",
        leadRoutingModeBalanced: "Dengeli (en az atanmış lead)",
        leadRoutingFixedDoctor: "Sabit doktor",
        leadRoutingSave: "Yönlendirme ayarlarını kaydet",
        leadRoutingSaved: "Yönlendirme ayarları kaydedildi.",
        leadRoutingLoadError: "Yönlendirme ayarları yüklenemedi.",
        leadRoutingTableMissing: "Veritabanında clinic_lead_routing_settings tablosu yok; migration uygulayın.",
        tabNeedsAssignment: "Atama gerekli",
        tabRecentlyRouted: "Yeni yönlendirilen",
        tabAssigned: "Atanmış",
        thChannel: "Kanal",
        thAssignedAt: "Atandı",
        searchPlaceholder: "Kullanıcı, telefon, mesaj ara…",
        channelMessenger: "Messenger",
        channelWhatsapp: "WhatsApp",
        channelWeb: "Web",
        channelUnknown: "Diğer",
        emptyNeedsAssignment: "Manuel atama gerektiren lead yok.",
        emptyRecentRouted: "Son 24 saatte otomatik yönlendirilen lead yok.",
        emptyAssigned: "Atanmış lead yok.",
        statusNeedsAssignment: "{count} atama bekleyen lead",
        statusRecentRouted: "{count} yeni yönlendirilen lead",
        statusAssigned: "{count} atanmış lead",
        badgeNewRouted: "Yeni yönlendirildi",
      }
    },

    en: {
      // Common
      common: {
        loading: "Loading...",
        save: "Save",
        cancel: "Cancel",
        delete: "Delete",
        edit: "Edit",
        search: "Search",
        filter: "Filter",
        close: "Close",
        back: "Back",
        next: "Next",
        previous: "Previous",
        submit: "Submit",
        yes: "Yes",
        no: "No",
        ok: "OK",
        error: "Error",
        success: "Success",
        warning: "Warning",
        doctor: "Doctor"
      },

      adminPages: {
        travelH1: "✈️ Clinifly Admin – Travel",
        travelGlobalWarning: "⚠️ WARNING: Some fields are reserved for the user. Review the notes below.",
        travelWordHotel: "Hotel",
        travelWordFlights: "Flights",
        travelListSeparator: " and ",
        travelDynamicWarning: "⚠️ WARNING: The user will enter {list} details. You cannot edit these fields. The user will complete them in the mobile app.",
        healthH1: "🩺 Clinifly Admin – Health",
        doctorApplicationsH1: "Doctor applications",
        doctorAppsStatPending: "Pending",
        doctorAppsStatApproved: "Approved",
        doctorAppsStatRejected: "Rejected",
        doctorAppsStatTotal: "Total",
        doctorAppsLoading: "Loading doctors...",
        doctorAppsEmptyTitle: "No doctors yet",
        doctorAppsEmptyDesc: "No doctor application has been submitted yet.",
        activePatientsH1: "👨‍⚕️ Active users",
        activePatientsStatActive: "Active users",
        activePatientsStatPending: "Pending users",
        activePatientsStatTotal: "Total users",
        activePatientsStatClinic: "Clinics",
        activePatientsSearchPlaceholder: "Search by name, email or phone...",
        activePatientsAllClinics: "All clinics",
        activePatientsRefresh: "🔄 Refresh",
        activePatientsLoading: "🔄 Loading...",
        activePatientsEmpty: "No active users yet",
        treatmentCreateH1: "🏥 Create treatment",
        treatmentCreateSubtitle: "Create a new treatment group and assign doctors",
        patientDetailH1: "User detail",
        patientDetailBack: "Back",
        legacyNavClinics: "Clinics"
      },
      
      // Suspended Clinic Messages
      clinicSuspended: {
        title: "Your Account Has Been Temporarily Suspended",
        description: "Your clinic account is currently inactive. Access to the dashboard and user features is restricted.",
        reasonTitle: "Suspension Reason",
        reasonGeneric: "Your account is under review for system and security checks.",
        whatToDoTitle: "How to Reactivate?",
        steps: [
          "Our support team is reviewing your account",
          "We will contact you if necessary",
          "You can contact us with any questions"
        ],
        contactSupport: "Contact Support",
        learnMore: "Learn More",
        statusBadge: "Status: Suspended"
      },
      
      // Dashboard (admin.html)
      dashboard: {
        title: "Clinifly Admin – Dashboard",
        sidebar: {
          mainMenu: "Main Menu",
          management: "Management",
          logout: "Logout",
          clinic: "Clinic"
        },
        nav: {
          dashboard: "Dashboard",
          patients: "Users",
          invitePatients: "Invite Users",
          travel: "Travel",
          treatment: "Treatments",
          schedule: "Schedule",
          doctors: "Doctors",
          chat: "Chat",
          leads: "Lead inbox",
          leadsNeedsAssignment: "Needs assignment",
          leadsRecentlyRouted: "Recently routed",
          leadsAssigned: "Assigned",
          aiLeads: "Coordination Center",
          files: "Files",
          referrals: "Referrals",
          marketplaceProfile: "Directory Profile",
          successCenter: "Success Center",
          helpCenter: "Help Center",
          learningCandidates: "AI Learning",
          health: "Health",
          settings: "Settings",
          login: "Login",
          register: "Register Clinic"
        },
        charts: {
          metricTitleMonthlyPatients: "Monthly registered users",
          metricTitleMonthlyProcedures: "Monthly procedure count",
          chartLabelMonthlyRegistered: "Monthly registrations",
          activePatients: "Active Users",
          procedures: "Procedures",
          noData: "No data",
          trendNote: "Trend will improve as more data is collected",
          vsPreviousMonth: "vs previous month",
          noPreviousData: "No previous data",
          summaryActivePatients: "{count} active users • {month}",
          summaryMonthlyRegistered: "{count} registered • {month}",
          summaryProcedures: "{count} procedures • {month}"
        },
        clinicBadge: {
          noToken: "⚠️ No admin token. <a href=\"/admin-register.html\" style=\"color:var(--link);\">Register Clinic</a> to login.",
          switchClinic: "Switch clinic",
          clinicInfo: "Clinic: <strong>{name}</strong> ({code}) • Status: {status}",
          clinicNotFound: "Clinic information could not be retrieved. Please check admin token."
        },
        upcoming: {
          title: "📅 Clinic Timeline",
          subtitle: "All events (past and future)",
          empty: "No events.",
          overdue: "⚠️ Overdue Events ({count})",
          overdueDesc: "There are {count} overdue but incomplete events. Please check.",
          status: {
            planned: "Planned",
            done: "Done",
            completed: "Completed"
          },
          today: "Today",
          tomorrow: "Tomorrow",
          dayAfterTomorrow: "Day after tomorrow",
          daysLater: "{count} days later",
          weeksLater: "{count} weeks later",
          eventTypes: {
            TRAVEL_EVENT: "Travel Event",
            FLIGHT: "Flight",
            HOTEL: "Hotel",
            AIRPORT_PICKUP: "Airport Pickup",
            TREATMENT: "Treatment",
            CONSULT: "Consultation",
            FOLLOWUP: "Follow-up",
            LAB: "Lab / Scan",
            HEALTH: "Health Form",
            APPOINTMENT: "Appointment",
            PAYMENT: "Payment",
            SURGERY: "Surgery",
            CHECKUP: "Checkup"
          },
          summary: {
            overdue: "Overdue:",
            today: "Today:",
            tomorrow: "Tomorrow:",
            patients: "users",
            events: "events"
          }
        },
        planUsage: "Plan & usage",
        activeTreatments: "Active treatments",
        monthlyUploads: "Monthly uploads",
        referralInvites: "Referral invites",
        patientRoster: "Users (roster cap)",
        usagePeriodNote: "Monthly usage window (UTC): {period}",
        usageFreshness: "Counts refreshed at: {time}",
        upgrade: "Upgrade",
        unlimited: "Unlimited",
        planAlertCrit: "Limit reached. Upgrade to continue.",
        planAlertWarn: "You are close to your limit",
        planTierTitle: "Current subscription tier",
        confirmOpenPricing: "Open pricing page?\n\n{url}",
        metricsErrorHint: "Check browser console (F12) for details"
      },
      
      calendar: {
        documentTitle: "Calendar - Clinifly Admin",
        pageTitle: "Appointments",
        title: "Appointments",
        weekRangeTitle: "Week range",
        today: "Today",
        week: "Week",
        month: "Month",
        prev: "← Previous",
        previous: "← Previous",
        next: "Next →",
        timeColumn: "Time",
        doctor: "Doctor",
        chair: "Chair",
        allDoctors: "All doctors",
        allChairs: "All chairs",
        noEvents: "No events",
        noAppointmentsForWeek: "No appointments for the selected week.",
        noAppointmentsForRange: "No appointments in the selected range.",
        summaryLine: "{count} appts • {doctorCount} doctors • {chairCount} chairs",
        loading: "Loading...",
        tokenMissing: "Admin token not found. Please sign in again.",
        sessionExpired: "Session expired. Redirecting to sign-in...",
        fetchFailed: "Could not load appointments: {message}",
        doctorNotFound: "No doctor found",
        chairWithNumber: "Chair {n}"
      },
      
      // Pricing (pricing.html)
      pricing: {
        title: "Clinifly Pricing",
        subtitle: "Flexible plans based on your active user count",
        info: "Pay only based on your active user count.",
        free: {
          name: "Free",
          patients: "5 users",
          description: "Try Clinifly with real users.",
          cta: "Get Started"
        },
        basic: {
          name: "Pro",
          badge: "Popular",
          patients: "15 users",
          description: "Powerful package for growing clinics.",
          cta: "Upgrade"
        },
        pro: {
          name: "Premium",
          patients: "Unlimited users",
          description: "Premium support for enterprise clinics.",
          cta: "Upgrade",
          contactCta: "Contact Us"
        },
        periodMonthly: "/month",
        features: {
          allCore: "All core features",
          patientCommunication: "User communication",
          fileSharing: "File sharing",
          referral: "Referral system",
          branding: "Clinifly branding",
          customBranding: "Custom branding",
          analytics: "Basic analytics",
          support: "Email support",
          unlimitedPatients: "Unlimited users",
          advancedReferral: "Advanced referral (levels, campaigns)",
          prioritySupport: "Priority support",
          onboarding: "Custom onboarding"
        },
        comparison: {
          feature: "Feature",
          free: "Free",
          basic: "Pro",
          pro: "Premium",
          patients: "Active Users",
          unlimited: "Unlimited",
          coreFeatures: "Core Features",
          branding: "Clinifly Branding",
          customBranding: "Custom Branding",
          referral: "Referral System",
          advancedReferral: "Advanced Referral",
          analytics: "Analytics",
          support: "Support",
          community: "Community",
          email: "Email",
          priority: "Priority"
        },
        faq: {
          title: "Frequently Asked Questions",
          q1: {
            question: "How is active user count calculated?",
            answer: "Only APPROVED (active) users are counted. Pending, rejected, or cancelled users are not included in the limit."
          },
          q2: {
            question: "What happens when I reach the limit?",
            answer: "You can continue working with your existing users. Only new user approvals are blocked. You can upgrade to continue operations."
          },
          q3: {
            question: "Can I change plans?",
            answer: "Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately."
          },
          q4: {
            question: "What payment methods do you accept?",
            answer: "We accept credit cards, bank transfers, and local payment methods. All payments are secured with SSL."
          }
        },
        contact: {
          title: "Have special requirements?",
          description: "We offer custom plans for large clinics and enterprise solutions.",
          button: "Contact Us"
        }
      },
      
      // Treatment (admin-treatment.html)
      treatment: {
        patientName: "User Name (Select)",
        selectPatient: "— Select user —",
        patientHelp: "Automatically selected when opening Treatment from the user list. Changing the user here reloads data.",
        noPatientSelected: "No user selected. Please select a user.",
        loadingTreatments: "Loading treatments...",
        noTreatments: "No treatment plan found for this user.",
        addTreatment: "Add Treatment",
        saveTreatment: "Save Treatment",
        treatmentSaved: "✅ Treatment saved successfully!",
        treatmentDeleted: "✅ Treatment deleted successfully!",
        confirmDelete: "Are you sure you want to delete this treatment?",
        pageTitle: "Treatments - Clinifly Admin",
        upperJaw: "Upper jaw",
        lowerJaw: "Lower jaw",
        fdiUpper: "FDI 11–18 / 21–28",
        fdiLower: "FDI 31–38 / 41–48",
        selectedTooth: "Selected tooth:",
        selToothHint: "Tap a tooth to add a procedure.",
        clearSelection: "Clear selection",
        procedureType: "Procedure type",
        loadingProcedures: "Loading...",
        statusLabel: "Status",
        dateLabel: "Date",
        timeLabel: "Time",
        datePolicy: "Date policy",
        datePolicyManual: "MANUAL (create reminder)",
        datePolicyAuto: "AUTO (assign date automatically)",
        priceOptional: "Price (optional)",
        currencyLabel: "Currency",
        quantityLabel: "Quantity",
        chairNo: "Chair No",
        doctorLabel: "Doctor",
        doctorSelectOptional: "-- Select doctor (optional) --",
        addProcedure: "+ Add procedure",
        diagnosesOnTooth: "Diagnoses on this tooth",
        addDiagnosisBtn: "+ Add diagnosis",
        newDiagnosisTitle: "New diagnosis",
        icdCodeLabel: "ICD-10 code",
        descriptionLabel: "Description",
        toothNoLabel: "Tooth No",
        toothPlaceholderAuto: "auto",
        notesOptionalLabel: "Notes (optional)",
        notesPlaceholder: "Optional note...",
        proceduresOnTooth: "Procedures on this tooth",
        treatmentEventsTitle: "🦷 Treatment events (calendar)",
        treatmentEventsHelp: "Note: events are stored in the treatment_events table.",
        eventTitlePlaceholder: "Implant Day 1",
        eventDescPlaceholder: "CT scan + implant placement",
        teTypeTreatment: "Treatment",
        teTypeConsult: "Consultation",
        teTypeFollowup: "Follow-up",
        teTypeLab: "Lab / Scan",
        addEvent: "➕ Add event",
        eventListTitle: "Event list",
        thDateTime: "Date/Time",
        thType: "Type",
        thTitle: "Title",
        patientToothDiagnoses: "User tooth diagnoses",
        badgeToothDoctor: "Tooth No + doctor diagnosis",
        noDiagnosisSummary: "No diagnosis records.",
        emptyStateTitle: "No treatment records yet",
        emptyStateSub: "Treatments will appear here when loaded.",
        selectPatientAbove: "Select a user above.",
        loadingTreatmentsMsg: "Loading treatments...",
        loadFailed: "Failed to load: {error}",
        noRecordsYet: "No treatment records yet. Select a tooth and add a procedure.",
        loadedSummary: "{teethCount} teeth, {procCount} procedures loaded.",
        headerTitle: "Treatment",
        loadError: "Load error: {error}",
        selectToothFirst: "⚠️ Select a tooth first",
        toothLocked: "This tooth is extracted (locked). New procedures cannot be added.",
        selectProcedureType: "Select a procedure type.",
        invalidDateTime: "Invalid date/time format.",
        diagCodeOrDesc: "Enter ICD-10 code or description.",
        saveFailedWithMsg: "Could not save: {error}",
        deleteFailedWithMsg: "Could not delete: {error}",
        errorWithMsg: "Error: {error}",
        saveAllSuccess: "All procedures saved ✅",
        saveAllError: "Save error: {error}",
        deleteBtn: "Delete",
        eventsEmpty: "No events.",
        procLineTooth: "Tooth {tooth} • ",
        selToothHintLocked: "⛔ This tooth is extracted (locked). New procedures cannot be added. History only.",
        pickToothFromChart: "Click a tooth on the chart above to select it.",
        noProcOnTooth: "No procedures on this tooth yet.",
        noDiagOnTooth: "No diagnosis records for this tooth.",
        noDescription: "No description",
        diagGroupTooth: "🦷 Tooth {tooth}",
        diagGroupGeneral: "🦷 General diagnoses",
        diagNotAdded: "No diagnoses added",
        toothDiagCountTitle: "{count} diagnosis record(s) on this tooth",
        datePrefix: "Date:",
        chairLabel: "Chair",
        editInlineTitle: "Edit inline",
        statusSelectTitle: "Select status",
        statusCycleTitle: "Click to cycle status (PLANNED → ACTIVE → COMPLETED → CANCELLED → PLANNED)",
        inlineProcTypePh: "Procedure type",
        inlineUnitPricePh: "Unit price",
        inlineQtyPh: "Qty",
        inlineChairPh: "Chair No",
        inlineDoctorPick: "-- Select doctor --",
        deleteTitle: "Delete",
        selToothHintActive: "Select a tooth",
        status: {
          PLANNED: "Planned",
          ACTIVE: "In progress",
          COMPLETED: "Completed",
          CANCELLED: "Cancelled"
        }
      },
      
      // Login (admin-login.html)
      login: {
        title: "Clinic Login",
        subtitle: "Login with your existing clinic account",
        clinicCode: "Clinic Code",
        clinicCodeRequired: "*",
        clinicCodePlaceholder: "SAAT",
        clinicCodeHelp: "Enter your clinic code (e.g., SAAT, MOON, CLINIC01)",
        password: "Password",
        passwordRequired: "*",
        passwordHelp: "Enter your clinic password",
        submit: "Login",
        submitLoading: "Logging in...",
        registerLink: "Register New Clinic",
        dashboardLink: "Go to Dashboard",
        forgotPasswordLink: "Forgot password?",
        forgotTitle: "Forgot password",
        forgotSubtitle: "We will email a 6-digit verification code to your registered address.",
        forgotSend: "Send verification code",
        forgotResend: "Resend code",
        forgotResendWait: "Resend",
        forgotOtpTitle: "Email verification",
        forgotOtpSubtitle: "Enter the 6-digit code from your email.",
        forgotOtpCode: "Verification code",
        forgotVerifyOtp: "Verify code",
        forgotSetPasswordTitle: "New password",
        forgotSetPasswordSubtitle: "Verification complete — choose a new password.",
        forgotNewPassword: "New password",
        forgotConfirmPassword: "Confirm new password",
        forgotReset: "Save password",
        forgotBack: "Back to login",
        forgotSuccess: "Your password has been updated. You can sign in now.",
        forgotOtpSent: "Verification code sent to your email.",
        forgotPasswordMismatch: "Passwords do not match.",
        forgotPasswordTooShort: "Password must be at least 6 characters.",
        forgotInvalidIdentity: "Clinic code or email did not match our records.",
        forgotResetFailed: "Could not update password. Please try again.",
        forgotOtpInvalid: "Invalid or expired code.",
        forgotOtpRequired: "Complete email verification before resetting your password.",
        forgotRateLimit: "Please wait one minute before trying again.",
        success: "Welcome {name}! Login successful.",
        loginSuccess: "Login successful",
        sessionExpired: "⏰ Your session has expired or the token is invalid. Please log in again.",
        otpTitle: "OTP Verification",
        otpSubtitle: "Enter the verification code sent to your email",
        otpEmailHelp: "Enter the email address where you received the OTP",
        otpCode: "Verification Code",
        otpCodeRequired: "*",
        otpHelp: "Enter the 6-digit code sent to your email",
        verifyOTP: "Verify OTP",
        verifying: "Verifying",
        backToLogin: "Back to Login",
        errors: {
          clinicCodeRequired: "Please enter clinic code.",
          passwordRequired: "Please enter password.",
          emailRequired: "Please enter email address.",
          invalidCredentials: "Invalid clinic code or password. Please try again.",
          loginFailed: "Login failed. Please try again.",
          loginFailedDetail: "Login failed: {detail}",
          serverError: "Server error",
          apiNotJson: "API did not return JSON (HTML/error page). Check API root: {api}",
          genericError: "Login error: {error}",
          otpRequired: "Please enter the verification code.",
          otpInvalid: "Invalid verification code. Enter a 6-digit code.",
          otpFailed: "Verification failed. Please try again.",
          otpNotFound: "Verification code not found. Please request a new code.",
          otpExpired: "Verification code has expired. Please request a new code."
        }
      },

      auth: {
        email: "Email",
        password: "Password",
        confirm_password: "Confirm password",
        name: "Full name",
      },
      
      // Register (admin-register.html)
      register: {
        title: "Create Your Clinic",
        subtitle: "Get started in minutes — it's free.",
        clinicCode: "Clinic Code",
        clinicCodeRequired: "*",
        clinicCodeWhat: "What is a clinic code?",
        clinicCodeHelp: "Your clinic code is a short unique symbol for your clinic — like an abbreviation or badge. You choose it now; users enter this code in the app to connect with you.",
        clinicCodeTip1: "3–12 characters; uppercase letters and numbers only (e.g. CEM, ELKO, MOON)",
        clinicCodeTip2: "Derive it from your clinic name or pick something easy to remember",
        clinicCodeTip3: "This is not your password — you can share it with users",
        clinicCodePlaceholder: "e.g. CEM, ELKO, MOON",
        clinicCodeHint: "Examples: CEM, ELKO, SMILE",
        invitationCode: "Invitation Code",
        invitationCodeOptional: "(Optional)",
        invitationCodeHelp: "If you have a campaign code, enter it to activate your premium trial.",
        name: "Clinic Name",
        nameRequired: "*",
        namePlaceholder: "Moon Clinic",
        nameHelp: "Your clinic name",
        email: "Email",
        emailRequired: "*",
        emailPlaceholder: "clinic@example.com",
        emailHelp: "Your clinic email address",
        password: "Password",
        passwordRequired: "*",
        passwordHelp: "Minimum 6 characters",
        confirmPassword: "Confirm Password",
        confirmPasswordRequired: "*",
        confirmPasswordHelp: "Must match the password",
        phone: "Phone",
        phonePlaceholder: "+90 555 123 4567",
        address: "Address",
        addressPlaceholder: "Istanbul, Turkey",
        submit: "Register Clinic",
        submitLoading: "Registering...",
        loginLink: "Already have an account? Login",
        dashboardLink: "Go to Dashboard",
        errors: {
          clinicCodeRequired: "Please enter clinic code.",
          nameRequired: "Please enter clinic name.",
          emailRequired: "Please enter email address.",
          emailInvalid: "Please enter a valid email address.",
          emailExists: "This email address is already in use.",
          clinicCodeExists: "This clinic code is already in use.",
          passwordRequired: "Please enter password.",
          passwordMinLength: "Password must be at least 6 characters.",
          passwordMismatch: "Passwords do not match.",
          registerFailed: "Registration failed. Please try again.",
          genericError: "Registration error: {error}",
          termsNotAccepted: "Please accept the service agreement.",
          timeout: "Request timed out (60s). Check API URL and your network connection."
        },
        success: "Clinic registration successful! Redirecting to login page...",
        successTitle: "Registration Successful!",
        successMessage: "Your clinic has been registered successfully. The admin token has been saved in your browser.",
        clinicInformation: "Clinic Information",
        adminToken: "Admin Token",
        copyToken: "📋 Copy Token",
        goToPatients: "Go to Users List",
        goToDashboard: "Go to Dashboard",
        termsText: "I have read, understood and agree to the Clinifly Digital Platform Service Agreement. I acknowledge that services within the Free Package are free of charge, services outside the Free Package are paid, and the scope and price of these services will be determined separately.",
        connectingRetry: "⏳ Connecting… retrying in {seconds}s",
        otp: {
          title: "Email Verification",
          intro: "We've sent a verification code to {email}. Please enter the code below to complete your clinic registration.",
          codeLabel: "Verification Code",
          codeHelp: "Enter the 6-digit code from your email",
          verify: "Verify & Complete Registration",
          verifying: "Verifying...",
          resend: "Resend Code",
          sending: "Sending...",
          back: "Back to Registration",
          invalidCode: "Please enter a valid 6-digit verification code",
          resent: "A new verification code has been sent to your email",
          clinicCodeExists: "Clinic code {code} already exists. Redirecting to login...",
          emailExists: "Email {email} is already registered. Redirecting to login..."
        }
      },
      
      // Settings (admin-settings.html)
      settings: {
        title: "⚙️ Clinic Settings",
        pageTitle: "⚙️ Clinifly Admin – Settings",
        clinicInformation: "Clinic Information",
        brandingNotice: "Branding settings are only available for PRO plan.",
        subscriptionPlan: "Subscription Plan",
        subscriptionPlanHelp: "You can change FREE / BASIC / PRO package here.",
        usageLoading: "Loading…",
        usageActiveTreatments: "Active treatments",
        usageMonthlyUploads: "Monthly uploads (UTC month)",
        usageReferrals: "Referral invites (this UTC month)",
        usagePeriodNote: "Billing window (UTC month): {period}",
        usagePatients: "Users on roster",
        usageLoadFailed: "Could not load usage.",
        usageFreshness: "Snapshot time: {time}",
        currentPlan: "Current plan: {plan}",
        planUpgrade: "Upgrade plan",
        planChangesNote: "Plan changes are done via the pricing page.",
        locationTitle: "Location",
        locationAllPlans: "ALL PLANS",
        countryLabel: "Country",
        cityLabel: "City",
        cityPlaceholder: "Antalya, Istanbul, London, Tbilisi...",
        locationDiscoveryHelp: "Users can filter clinics by country and city on discovery.",
        selectCountry: "Select country",
        countryRequiredAlert: "Please select a country.",
        cityRequiredAlert: "City is required.",
        plan: "Plan",
        branding: "Branding",
        referralDiscounts: "🎁 Referral Discounts",
        referralDiscountsHelp: "Configure discount percentages for successful referrals. Both the referrer and the referred user receive these discounts.",
        referralDiscount: "Referral Discount (%)",
        referralDiscountHelp: "Discount applied to both referrer and referred user",
        referralSettings: "🎯 Referral Settings",
        referralSettingsHelp: "Set referral earnings rates. Flexible settings available in PRO plan.",
        referralPerInvite: "Per Invite Earnings (%)",
        referralPerInvitePlaceholder: "10",
        referralPerInviteHelp: "Discount given for each successful referral",
        referralMaxTotal: "Maximum Total Discount (%)",
        referralMaxTotalPlaceholder: "10",
        referralMaxTotalHelp: "Maximum discount the referrer can earn. If the referrer invites more than one person and the invited people's spending exceeds the referrer's spending, discount can be applied up to the maximum limit.",
        clinicName: "Clinic Name",
        clinicLogoUrl: "Clinic Logo URL",
        clinicLogoUrlHelp: "Logo will be displayed for Pro plan",
        chairCountLabel: "Chair count",
        chairCountHelp: "Number of chairs to show on the appointment calendar (e.g. 1, 2, 3).",
        address: "Clinic Address",
        addressHelp: "Required (all plans). Used for nearby search and pinning; address is geocoded via Google.",
        googleMapLink: "Google Maps Link",
        googleMapLinkHelp: "Optional (all plans). If set, coordinates are parsed from the link; otherwise the address above is used.",
        primaryColor: "Primary Color (Hex)",
        secondaryColor: "Secondary Color (Hex)",
        welcomeMessage: "Welcome Message",
        referralDiscounts: "🎁 Referral Discounts",
        referralDiscountsHelp: "Discount levels used in the referral system",
        referralDiscount: "Referral Discount (%)",
        referralDiscountHelp: "Discount applied to both referrer and referred user",
        aiCommunication: {
          title: "AI Communication",
          desc: "Set first-response speed on Messenger, Instagram, and WhatsApp. <strong>Instant</strong> mode greets users within seconds. <strong>Wait for human</strong> lets AI step in after your team does not reply within the time below.",
          instant: "Instant AI replies (group rapid messages into one reply on Messenger/WhatsApp)",
          waitHuman: "Wait for human before AI",
          humanOnly: "Human-only (no AI auto-reply)",
          timingHintInstant:
            "Instant mode: when patients send several short messages in a row, AI waits briefly then replies once to the whole burst. Recommended: 5 seconds.",
          timingHintWait:
            "Wait for human: if your team does not reply within the time below, AI sends the first message. No instant auto-greeting.",
          timingHintHumanOnly:
            "No automatic AI replies on Messenger or WhatsApp — your team handles every message.",
          humanTakeoverLabel: "Team silence before AI steps in",
          secondsWord: "sec",
          messageBufferLabel: "AI response delay (group rapid messages)",
          bufferInstant: "Instant (no grouping)",
          buffer3s: "3 seconds",
          buffer5s: "5 seconds (recommended)",
          buffer10s: "10 seconds",
          messageBufferHelp:
            "When patients send several short messages in a row, wait this long after the last one, then send one AI reply to the whole burst (Messenger / WhatsApp / Instagram).",
          omniDelayLabel: "Instant reply delay (Messenger / WhatsApp)",
          omniDelayHelp:
            "Use «AI response delay» above instead. Recommended 5 seconds to group rapid messages into one natural reply.",
          fallbackHelp:
            "Only in &quot;Wait for human&quot; mode: AI sends the first message if your team is silent for this long.",
          bookingModeLabel: "AI calendar booking mode",
          bookingDraft: "Draft booking (staff approval) — recommended",
          bookingSuggest: "Suggest only (no calendar write)",
          bookingAuto: "Full auto booking (confirmed immediately)",
          bookingHint: "AI checks real calendar availability, requires phone/WhatsApp before booking, and respects working hours, buffers, and lunch breaks.",
          clinicHoursLabel: "Clinic hours (AI scheduling)",
          clinicOpenLabel: "Opens",
          clinicCloseLabel: "Closes",
          clinicTimezoneLabel: "Clinic timezone",
          clinicHoursHint: "AI only offers appointment slots within these hours (clinic local time). If a user asks outside hours, the AI offers the next available slot.",
          weekdayBlockTitle: "Weekday hours (Monday–Friday)",
          saturdayBlockTitle: "Saturday hours",
          sundayBlockTitle: "Sunday hours",
          enableSaturday: "Enable Saturday",
          enableSunday: "Enable Sunday",
          weekday24Hours: "Open 24 hours (Mon–Fri)",
          day24Hours: "Open 24 hours",
          open247: "Open 24/7 (all days)",
          save: "Save AI communication",
          loading: "Loading…",
          signInRequired: "Sign in to configure AI communication.",
          loadFailed: "Could not load AI communication settings.",
          saving: "Saving…",
          saveFailed: "Save failed: {error}",
          saved: "Saved. Messenger/WhatsApp will use these reply timings.",
        },
        communicationChannels: {
          title: "Communication Channels",
          desc: "Connect external channels so user messages appear in your AI coordinator inbox with source badges (WhatsApp, Messenger, Instagram, Web).",
          whatsapp: "WhatsApp →",
          messenger: "Messenger →",
        },
        colorCategories: {
          blue: "Blue / Trust",
          green: "Green / Health",
          purple: "Purple / Premium",
          orange: "Orange / Action",
          red: "Red / Campaign",
          neutral: "Neutral / Corporate",
        },
        variants: {
          options: "Options",
          btn: "Variants",
          btnHide: "Hide variants",
          aiNamesBtn: "AI names",
          aiNamesHide: "Hide names",
          brandVariantTitle: "Brand variant {n}",
          remove: "Remove",
          brand: "Brand *",
          country: "Country of origin",
          tier: "Segment / tier",
          priceFrom: "Price from",
          priceTo: "Price to",
          currency: "Currency",
          aiNotes: "AI notes",
          defaultOption: "Default option for this treatment",
          panelTitle: "{treatment} — brand / material variants",
          panelHint: "Each variant is a brand + origin + segment + price range (e.g. Straumann / Switzerland / Premium / 900–1200 EUR). AI uses estimate language only.",
          addVariant: "+ Add variant",
          labelsPanelTitle: "AI display names (optional translations)",
          labelsPanelHint: "Localized treatment names for multilingual AI replies — not brand or pricing variants.",
          labelPlaceholder: "Optional AI display name",
        },
        referralLevel1: "Level 1 (%)",
        referralLevel1Help: "Total discount after 1 successful referral",
        referralLevel2: "Level 2 (%)",
        referralLevel2Help: "Total discount after 2 successful referrals",
        referralLevel3: "Level 3 (%)",
        referralLevel3Help: "Maximum discount for 3+ referrals",
        temporaryPatientLimit: "🔧 Temporary User Limit",
        temporaryPatientLimitHelp: "Add temporary user limit for sales and onboarding processes. This is added on top of the normal plan limit.",
        temporaryLimit: "Temporary Limit",
        temporaryLimitPlaceholder: "Additional users (e.g., 5)",
        saveTemporaryLimit: "Save Temporary Limit",
        removeTemporaryLimit: "Remove Temporary Limit",
        temporaryLimitActive: "Current temporary limit: +{count} users",
        referralPreviewLabel: "💡 Preview:",
        referralPreviewNone: "❌ No discount will be applied",
        referralPreviewLow: "✅ <strong>{discount}% discount</strong> will be applied to both referrer and referred user.<br><span style=\"color:#10b981\">💡 Great starting point for attracting new users!</span>",
        referralPreviewMid: "🎉 <strong>{discount}% discount</strong> for both parties.<br><span style=\"color:#f59e0b\">⚠️ Higher discount but more attractive referrals!</span>",
        referralPreviewHigh: "🚀 <strong>{discount}% discount</strong> - Maximum level!<br><span style=\"color:#ef4444\">⚠️ Very generous - ensure profitability!</span>",
        save: "💾 Save Settings",
        saveLoading: "Saving...",
        treatmentPriceList: "💰 Treatment Price List",
        treatmentPriceListHelp: "Single source of truth for appointment pricing and AI coordinator replies. Use <strong>Variants</strong> for brand/material/pricing options (e.g. Straumann, Megagen). Use <strong>AI names</strong> only for optional multilingual treatment display labels — not for brands.",
        currency: "Currency",
        loadingPrices: "Loading prices...",
        saveAllPrices: "💾 Save All Prices",
        savingPrices: "💾 Saving...",
        pricesSaved: "✅ All prices saved successfully!",
        errors: {
          noToken: "Admin token not found. Please login as admin.",
          loadFailed: "Failed to load settings: {error}",
          saveFailed: "Failed to save settings: {error}",
          pricesLoadFailed: "Failed to load prices: {error}",
          pricesSaveFailed: "Failed to save prices: {error}"
        },
        success: "✅ Settings saved successfully!",
        categoryLabels: {
          EVENTS: "Events / Imaging",
          PROSTHETIC: "Prosthetic (Protez)",
          RESTORATIVE: "Restorative (Restoratif)",
          ENDODONTIC: "Endodontic (Endodontik)",
          SURGICAL: "Surgical (Cerrahi)",
          IMPLANT: "Implant"
        },
        tableHeaders: {
          treatment: "Treatment",
          price: "Price",
          recommended: "Recommended",
          duration: "Duration (min)",
          breakMin: "Break (min)",
          active: "Active",
          options: "Options",
        },
        recommendedDuration: "~{minutes} min",
        minutes: "min",
        opsProfileCardTitle: "Clinic AI Training",
        opsProfileCardDesc: "Teach your AI how your clinic works — what it should know, how it should talk to users, and when to bring in your team.",
        opsProfileCardPricing: "Pricing & brand variants are configured in the <strong>Treatment Price List</strong> below (one source for appointments + AI).",
        opsProfileOpen: "Open AI Training Center →",
      },

      opsProfile: {
        pageTitle: "Clinic AI Training — Clinifly Admin",
        title: "Clinic AI Training",
        lead: "Teach your AI assistant how your clinic works — what it knows, how it responds to users, and when to escalate to your team.",
        policyLayerTitle: "Clinic-wide AI rules (maximum allowed)",
        policyLayerBody: "Define what AI may do across your clinic — categories, safety limits, languages, and escalation. This is the ceiling; coordinators and doctors set what is active per user in the Coordination Center or doctor app.",
        liveControlNote: "Per-user Off / Assist / Active is not set here — use live AI coordination on each inquiry.",
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
        openJourneys: "Open treatment workflows",
        openHotelManager: "Open full hotel manager →",
        priceListLink: "→ Treatment Price List",
        priceListHint: "(operational + AI pricing)",
        multilingualNoteTitle: "One clinic knowledge, many languages.",
        multilingualNoteBody: "Enable languages below. Brands, pricing, logistics, and process knowledge stay in one place — the AI responds naturally in each language without re-entering everything.",
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
          aiProfile: { title: "How your AI speaks", hint: "Languages, tone, and greetings — teach your clinic voice." },
          conversionCoordinator: {
            title: "Conversion Coordinator",
            hint: "Trust-first behavioral governance — tone, CTA, pricing, forbidden phrases (not a sales bot).",
          },
          materials: { title: "Brands & materials", hint: "Implant brands, labs, warranty — so replies stay accurate." },
          travel: { title: "Travel & stays", hint: "Partner hotels for medical travel questions." },
          logistics: { title: "Hours & coordination", hint: "Opening hours, response targets, emergency contact." },
          payment: { title: "Payment policies", hint: "Deposits, financing, refunds — AI explains; humans handle disputes." },
          workflow: { title: "Treatment journey knowledge", hint: "Visit length, recovery — guidance, not diagnosis." },
          aiSafety: { title: "When AI needs a human", hint: "What the AI can answer alone vs suggest vs hand off." },
          handoff: { title: "Escalation rules", hint: "When the AI alerts your coordinator or doctor." },
          internalNotes: { title: "Clinic story (internal)", hint: "Positioning and priorities — shapes tone, not shown verbatim to patients." }
        },
        conversion: {
          introTitle: "AI Treatment Coordinator",
          introBody: "behavioral governance (not a sales bot). Conversion Engine is on by default.",
          engineEnabled: "Conversion Engine enabled",
          recordTimelineEvents: "Record conversion timeline events",
          safetyHeading: "Safety phrase categories",
          presets: {
            soft_conversion_coordinator: "Soft Conversion Coordinator (default)",
            luxury_clinic: "Luxury Clinic",
            budget_clinic: "Budget Clinic",
            dental_tourism: "Dental Tourism",
            implant_focused: "Implant Focused",
            cosmetic_dentistry: "Cosmetic Dentistry",
            international_patients: "International Users",
            consultation_focused: "Consultation Focused",
          },
          intensity: {
            gentle: "Gentle — informational, trust-first",
            balanced: "Balanced — active coordinator",
            proactive: "Proactive — conversion-focused (never pushy)",
          },
          ctaStyle: {
            soft: "Soft — optional follow-up (If you would like, I can explain the process)",
            balanced: "Balanced — outline visits and preparation",
            proactive: "Proactive — clear next step (e.g. upload X-ray when ready)",
          },
          pricingBehavior: {
            educate_then_range: "Educate, then give range",
            range_only: "Range only (brief)",
            defer_to_coordinator: "Defer to coordinator",
          },
          nextStep: {
            collect_xray: "Collect X-ray / imaging",
            book_consultation: "Book consultation",
            start_whatsapp: "Start WhatsApp conversation",
            schedule_visit: "Schedule clinic visit",
            collect_user_info: "Collect user information",
            explain_treatment_process: "Explain treatment process",
          },
        },
        sedationAvailable: "Sedation available",
        weekendAvailability: "Weekend availability",
        sameDayTreatment: "Same-day treatment",
        airportTransfer: "Airport transfer",
        depositRequired: "Deposit required",
        installments: "Installments",
        financing: "Financing",
        creditCard: "Credit card",
        autonomyIntro: "Choose how independently the AI may respond. Medical topics always require a human.",
        autonomyCategory: "Category",
        autonomyLevel: "Level",
        safetyIntro: "Always require human review (never auto-sent for medical advice):",
        handoffIntro: "When checked, the AI stops auto-replying and alerts your team.",
        workflowJourneysHint: "Teach the AI how each treatment usually runs at your clinic — visit timing, recovery expectations, and follow-up steps.",
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
          angryUser: "Angry user",
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
        langs: { en: "English", tr: "Turkish", ru: "Russian", ka: "Georgian", ar: "Arabic", de: "German", fr: "French" },
        ui: {
          usedByAi: "Used by AI replies",
          usedByAiTitle: "This teaches your AI assistant",
          usedByAiSection: "Used by AI",
          seeExample: "See example",
          aiPrefix: "AI:"
        },
        visibility: {
          patient_visible: { short: "User-visible", label: "May appear in user messages" },
          ai_reply: { short: "AI replies", label: "Used by AI replies" },
          internal: { short: "Internal", label: "Internal / operational only" }
        },
        options: {
          toneStyle: {
            warm_professional: "Warm + professional",
            clinical_concise: "Clinical & concise",
            friendly_casual: "Friendly & casual",
            luxury_premium: "Luxury / premium"
          },
          signatureStyle: {
            name_only: "Assistant name only",
            name_clinic: "Name + clinic",
            none: "No signature"
          }
        },
        sectionHelp: {
          aiProfile: {
            intro: "Choose which languages users can use and how your assistant should sound. Clinic knowledge stays in one place — the AI responds naturally in each language.",
            aiUsageSummary: "Language choice, greetings, signatures, and communication tone."
          },
          conversionCoordinator: {
            intro: "Trust-first soft conversion — tone, CTA, pricing, and forbidden phrases. Not a sales bot; the Conversion Engine guides coordinator replies.",
            aiUsageSummary: "Strategy block in coordinator chats; optional timeline analytics.",
          },
          materials: {
            intro: "Which brands and materials your clinic works with. Helps AI explain options without inventing brands.",
            aiUsageSummary: "Educational replies about implants, zirconium, labs, warranty."
          },
          logistics: {
            intro: "Hours, response times, and day-to-day clinic coordination.",
            aiUsageSummary: "Scheduling, availability, and emergency routing."
          },
          payment: {
            intro: "Deposits, financing, refunds. AI explains policies — does not negotiate or promise exceptions.",
            aiUsageSummary: "Payment and policy questions; escalates refunds to humans."
          },
          workflow: {
            intro: "Visit timelines, healing periods, and post-treatment coordination. Operational guidance only — not diagnosis.",
            aiUsageSummary: "Treatment process, recovery, follow-up, and post-op user questions."
          },
          aiSafety: {
            intro: "How much the AI can act alone vs suggest drafts. Medical topics always stay human-reviewed.",
            aiUsageSummary: "Per topic: auto-reply, suggest-only, or off."
          },
          handoff: {
            intro: "When the AI must stop and alert your coordinator or doctor.",
            aiUsageSummary: "Triggers that move a conversation to your team."
          },
          internalNotes: {
            intro: "Clinic positioning and strategy. Helps AI align with your brand — not shown verbatim to users.",
            aiUsageSummary: "Internal context for tone, priorities, and what to emphasize."
          },
          travel: {
            intro: "Partner hotels — the AI can suggest up to 3 active properties for medical travel questions.",
            aiUsageSummary: "Stays, transfers, and travel planning questions."
          }
        },
        autonomyLevels: {
          OFF: "Off",
          SUGGEST_ONLY: "Suggest only",
          AUTO_REPLY: "Auto-reply",
          FULLY_AUTONOMOUS: "Fully autonomous"
        },
        fieldHelp: {
          supportedLanguages: {
            label: "Multilingual AI support",
            helper: "Choose languages for user chats. Clinic knowledge stays in one place — the AI responds in each enabled language.",
            aiUsage: "User language detection, reply language, and human-staff routing hints.",
            example: "English (primary), Turkish, Russian, Georgian for dental tourism."
          },
          displayNameLocalized: {
            label: "Assistant name (localized)",
            helper: "Optional per-language assistant display names. Leave blank to let AI translate from English.",
            aiUsage: "Greetings and signatures in the user's language.",
            example: "en: DentX Care Team · tr: DentX Kullanıcı Destek Ekibi"
          },
          welcomeMessageLocalized: {
            label: "Welcome message (localized)",
            helper: "Optional opening message templates per language — not required for MVP.",
            aiUsage: "First-contact tone and clinic introduction.",
            placeholder: "Short welcome in each enabled language"
          },
          toneStyle: {
            label: "Tone / style",
            helper: "Overall communication style for user chats.",
            aiUsage: "Sets warmth, formality, and luxury level in replies.",
            example: "Warm + professional for international dental tourists."
          },
          signatureStyle: {
            label: "Signature style",
            helper: "How messages are signed at the end.",
            aiUsage: "Appended to AI-generated user messages."
          },
          profileTags: {
            label: "Profile tags",
            helper: "Short tags describing your clinic vibe (luxury, fast response, etc.).",
            aiUsage: "Internal tone hints — not shown directly to users.",
            placeholder: "luxury, friendly, premium, fast_response",
            example: "premium, friendly, fast_response"
          },
          preset: {
            label: "Clinic preset",
            helper: "Pre-configured conversion style for your clinic type — adjusts tone, CTA, and pricing behavior.",
            aiUsage: "Loads preset rules into the Conversion Engine strategy block.",
          },
          coordinatorIntensity: {
            label: "Coordinator intensity",
            helper: "How actively the AI guides users toward next steps while staying trust-first.",
            aiUsage: "Sets conversion posture: gentle (informational), balanced, or proactive.",
          },
          ctaStyle: {
            label: "Call-to-action style",
            helper: "How directly the AI suggests next steps (X-ray, consult, WhatsApp, visit).",
            aiUsage: "Shapes closing lines and follow-up invitations in replies.",
          },
          pricingBehavior: {
            label: "Pricing behavior",
            helper: "Whether the AI educates before giving ranges, gives brief ranges only, or defers to a human coordinator.",
            aiUsage: "Controls price-related replies when users ask about cost.",
          },
          nextStepPreference: {
            label: "Preferred next steps",
            helper: "Which next steps the AI should prioritize when appropriate (not all at once).",
            aiUsage: "Guides CTA selection in coordinator conversations.",
          },
          forbidden_guarantees: {
            label: "Forbidden guarantees",
            helper: "Phrases the AI must never use (one per line).",
            aiUsage: "Safety filter for outcome and warranty language.",
            placeholder: "guaranteed results\n100% success",
          },
          forbidden_diagnosis: {
            label: "Forbidden diagnosis language",
            helper: "Diagnostic claims or certainty phrases to block.",
            aiUsage: "Keeps replies operational, not clinical diagnosis.",
          },
          forbidden_claims: {
            label: "Forbidden marketing claims",
            helper: "Overpromising or comparative claims to avoid.",
            aiUsage: "Brand-safe, compliant user messaging.",
          },
          forbidden_urgency: {
            label: "Forbidden urgency pressure",
            helper: "High-pressure urgency phrases to block.",
            aiUsage: "Prevents pushy or fear-based conversion tactics.",
          },
          implantBrands: {
            label: "Implant brands",
            helper: "Brands you routinely use. AI can compare at a high level — not medical recommendations.",
            aiUsage: "Brand and option explanations.",
            placeholder: "Straumann, Nobel, Osstem"
          },
          premiumBrands: { label: "Premium brands", helper: "Higher-tier brands if you offer them.", aiUsage: "Upsell or comparison replies when patients ask about premium options." },
          zirconiumTypes: { label: "Zirconium types", helper: "Materials for crowns/veneers you use.", aiUsage: "Cosmetic and crown material questions.", placeholder: "E.max, multilayer zirconia" },
          labPartners: { label: "Lab partners", helper: "In-house or partner labs — builds trust in process answers.", aiUsage: "Operational process explanations." },
          warrantyInformation: { label: "Warranty policy", helper: "Summary of warranty terms. Keep factual; AI will not invent legal guarantees.", aiUsage: "Warranty and guarantee questions.", placeholder: "10-year implant warranty with annual check-up" },
          sedationAvailability: { label: "Sedation available", helper: "Whether sedation is offered for anxious patients.", aiUsage: "Comfort and anxiety-related questions." },
          weekdayHours: { label: "Weekday hours", helper: "When the clinic is normally open for appointments and replies.", aiUsage: "Scheduling and “when are you open?” questions.", placeholder: "09:00 – 18:00" },
          timezone: { label: "Clinic timezone", helper: "IANA timezone for scheduling and response-time calculations.", aiUsage: "Converts appointment times and response windows for international patients.", placeholder: "Europe/Istanbul" },
          averageResponseSlaMinutes: { label: "Target reply time (minutes)", helper: "How quickly your team should respond when the AI hands off. Not shown to patients.", aiUsage: "When to nudge coordinators if no human reply yet.", placeholder: "120" },
          emergencyContact: { label: "Emergency contact", helper: "Phone or instruction for urgent cases. AI directs emergencies here — does not give medical advice.", aiUsage: "Urgent / severe pain routing (with human handoff)." },
          transportationNotes: { label: "Transport notes", helper: "Airport pickup, VIP transfer, shuttle details.", aiUsage: "Travel and arrival coordination." },
          refundPolicy: { label: "Refund policy", helper: "Your standard refund rules. AI summarizes — escalates disputes to humans.", aiUsage: "Refund questions (with handoff for conflicts)." },
          cancellationPolicy: { label: "Cancellation policy", helper: "Cancellation terms for appointments or packages.", aiUsage: "Scheduling and cancellation questions." },
          positioningNotes: { label: "Positioning bullets", helper: "How you want the clinic positioned. One point per line.", aiUsage: "Shapes AI emphasis — not quoted directly." },
          freeformNotes: { label: "Additional internal notes", helper: "Anything else your team should know when the AI coordinates patients.", aiUsage: "Extra context for patient coordination." },
          protocol_postOpNotes: {
            label: "Post-op coordination notes",
            helper: "Describe how your clinic usually guides users after treatment.",
            aiUsage: "Post-operative coordination replies — not a substitute for doctor advice."
          }
        }
      },

      travel: {
        pageTitle: "Travel & Accommodation — Clinifly Admin",
        breadcrumbSettings: "Clinic Settings",
        breadcrumbCurrent: "Travel & Accommodation",
        title: "Travel & Accommodation",
        lead: "Partner hotels define which stays the AI can suggest for travel and accommodation questions — up to 3 active properties are used per conversation.",
        partnerHotels: "Partner hotels",
        addHotel: "+ Add hotel",
        editHotel: "Edit hotel",
        emptyList: "No partner hotels yet. Add your first property so the AI can recommend stays.",
        loading: "Loading…",
        futureNote: "Coming later: airport transfers, drivers, translators, apartments — architecture prepared, not enabled yet.",
        saveHotel: "Save hotel",
        cancel: "Cancel",
        delete: "Delete",
        edit: "Edit",
        deleteConfirm: "Delete this hotel?",
        openMaps: "Open Maps",
        minFromClinic: "min from clinic",
        chipPreferred: "Preferred",
        chipActive: "Active",
        chipInactive: "Inactive",
        chipTransfer: "Transfer",
        chipBreakfast: "Breakfast",
        fieldName: "Name *",
        fieldPrice: "Price range (approx.)",
        fieldDistance: "Distance (minutes from clinic)",
        fieldSort: "Sort order",
        fieldAddress: "Address",
        fieldMaps: "Google Maps URL",
        fieldBooking: "Booking URL (optional)",
        fieldLangs: "Supported languages",
        fieldDiscount: "Clinic discount notes",
        fieldNotes: "Internal notes",
        checkTransfer: "Transfer included / can arrange",
        checkBreakfast: "Breakfast included",
        checkPreferred: "Preferred partner",
        checkActive: "Active (visible to AI)",
        phName: "Radisson Blu Tbilisi",
        phPrice: "120–180 USD / night",
        phDistance: "8",
        phAddress: "Rose Revolution Square…",
        phMaps: "https://maps.google.com/…",
        phLangs: "en, ru, tr",
        phDiscount: "10% clinic partner rate",
        phNotes: "Coordinator-only notes",
        errLoad: "Failed to load",
        errDelete: "Delete failed",
        errSave: "Save failed"
      },

      treatmentWorkflows: {
        pageTitle: "Treatment Workflows — Clinifly Admin",
        breadcrumbSettings: "Clinic Settings",
        breadcrumbAiTraining: "AI Training",
        breadcrumbCurrent: "Treatment workflows",
        title: "Treatment workflows",
        lead: "Teach the AI how treatment journeys usually work at your clinic, including visit timing, recovery expectations, and follow-up steps.",
        intro: "Add typical visit counts, stay duration, and post-treatment guidance for each treatment type. The AI uses this to explain your clinic’s usual process to users — not as medical diagnosis or prescriptions.",
        panelTitle: "Your treatment workflows",
        addWorkflow: "+ Add workflow",
        editWorkflow: "Edit workflow",
        addWorkflowForm: "Add workflow",
        emptyList: "No workflows yet. Add implant, veneers, or other treatments so the AI knows how your clinic usually handles them.",
        loading: "Loading…",
        futureNote: "Coming later: procedure stages, recovery milestones, and coordinator checklists.",
        fieldTreatment: "Treatment type *",
        fieldVisits: "Typical visit count",
        fieldSort: "Sort order",
        fieldLangs: "Languages",
        checkXray: "X-ray / imaging usually required",
        checkTemp: "Temporary teeth possible",
        checkActive: "Use in user conversations",
        saveWorkflow: "Save workflow",
        cancel: "Cancel",
        delete: "Delete",
        edit: "Edit",
        deleteConfirm: "Delete this workflow?",
        chipActive: "Active",
        chipInactive: "Inactive",
        chipXray: "X-ray",
        chipTemp: "Temp teeth",
        noTimeline: "No timeline configured yet",
        visits: "visits",
        secondVisit: "2nd visit:",
        setupPreparing: "Treatment workflows are being prepared for your clinic. You can review this page now; saving will be available once setup is complete. If this message persists, contact Clinifly support.",
        setupNotReady: "AI workflow setup is not fully ready yet. Please refresh in a moment or contact support.",
        errLoad: "Could not load workflows. Please refresh the page.",
        errSave: "Could not save right now. Please try again.",
        errDelete: "Could not delete. Please try again.",
        errReorder: "Could not save order. Please try again.",
        customTypeOption: "Other treatment…",
        customTypePrompt: "Treatment name (e.g. sinus lift):"
      },

      patientInvite: {
        dashboardTitle: "User Invitation",
        quickTitle: "Invite users",
        quickHint: "Share your link or QR so users join automatically — no manual clinic code.",
        pageTitle: "Invite Users",
        pageSubtitle: "Share your invitation link or QR code. New users are linked to your clinic automatically after signup.",
        copyLink: "Copy Invitation Link",
        showQr: "Show QR Code",
        downloadQr: "Download QR",
        printPoster: "Print Poster",
        invitationUrl: "Invitation URL",
        modalTitle: "User invitation",
        clinicLabel: "Clinic",
        copied: "Copied!",
        allowPopups: "Allow pop-ups to print the poster.",
        posterTagline: "Scan to join our clinic on Clinifly",
        openFullPage: "Open invite page",
        codeHint: "Clinic code: {code}",
        codeHintSuffix: "Users who scan the QR are linked to your clinic after signup.",
        qrLoadError: "QR could not be loaded. Try again or use Copy Link."
      },

      // Patients (admin-patients.html)
      patients: {
        title: "Clinifly Admin – Users",
        registeredPatients: "Registered Users",
        searchPlaceholder: "Search: name / phone / patientId / clinicCode",
        filterAll: "All",
        clearFilters: "Clear",
        refresh: "Refresh",
        loading: "Loading...",
        noResults: "No results",
        selectedPatient: "Selected User: {name}",
        patientId: "User ID: {id}",
        copyId: "Copy ID",
        copyIdSuccess: "✅ Kullanıcı ID copied",
        clear: "Clear",
        travel: "Travel",
        treatment: "Treatment",
        health: "Health",
        chat: "Chat",
        files: "📁 Files",
        approve: "Approve",
        approveConfirm: "Are you sure you want to approve this patient? ({patientId})",
        approveSuccess: "✅ User approved",
        addPatient: "➕ Add user",
        addPatientTitle: "Add new user",
        firstName: "First name *",
        lastName: "Last name *",
        email: "Email",
        dateOfBirth: "Date of birth",
        address: "Address",
        notes: "Notes",
        cancel: "Cancel",
        add: "Add user",
        addSuccess: "✅ User added successfully",
        addError: "❌ Could not add user",
        assignDoctorLabel: "Assign doctor:",
        assignButton: "Assign",
        selectDoctorPlaceholder: "Select doctor",
        noDoctorAssigned: "No doctor assigned",
        before: "Before",
        after: "After",
        phone: "Phone",
        status: {
          PENDING: "Pending",
          APPROVED: "Approved"
        },
        errors: {
          noToken: "⚠️ Admin token not found. Please login first.",
          unauthorized: "❌ Authorization error. Please login again.",
          loadFailed: "❌ Failed to load user list: {error}",
          approveFailed: "❌ Approval error: {error}",
          patientLimitReached: "⚠️ You've reached your active user limit. Upgrade your plan to add new users.",
          patientLimitReachedTitle: "User Limit Reached"
        },
        limits: {
          title: "Active User Limit",
          message: "Your current plan has {current}/{limit} active users.",
          upgradeMessage: "Upgrade your plan to add new users.",
          upgradeButton: "Upgrade Plan",
          continueButton: "Continue with Existing Users"
        }
      },
      
      // Referrals (admin-referrals.html)
      referrals: {
        title: "🎁 Clinifly Admin – Referrals",
        referrals: "Referrals",
        filterAll: "All",
        refresh: "↻ Refresh",
        loading: "Loading...",
        noReferrals: "No referrals found.",
        inviter: "Inviter",
        invited: "Invited",
        createdAt: "Created",
        inviterDiscount: "Inviter Discount",
        invitedDiscount: "Invited Discount",
        discount: "Discount",
        approve: "Approve",
        reject: "Reject",
        approveConfirm: "Are you sure you want to approve this referral?",
        rejectConfirm: "Are you sure you want to reject this referral?",
        approved: "Referral approved ✅",
        rejected: "Referral rejected ✅",
        found: "{count} referrals found.",
        activityPageTitle: "🎁 Referral activity",
        statTotalReferrers: "Total referrers",
        statInvitedUtcMonth: "Invited this UTC month",
        statInvitedUtcMonthTitle: "Same as Plan & usage → Referral invites (billing / SaaS)",
        statTotalInvitedAllTime: "Total invited (all time)",
        statRegistered: "Registered",
        statTreated: "Treated",
        statPending: "Pending approval",
        pendingSectionTitle: "Referrals pending approval",
        thStatus: "Status",
        thCode: "Code",
        thDate: "Date",
        thActions: "Actions",
        summaryTitle: "Referrer summary",
        filterAllStatuses: "All statuses",
        filterRegisteredOpt: "Registered",
        filterTreatedOpt: "Treated",
        filterRewardedOpt: "Rewarded",
        thReferrer: "Referrer",
        thInvitedCount: "Invited",
        thRegisteredCount: "Registered",
        thTreatedCount: "Treated",
        thInvitedPatients: "Invited users",
        loadingMain: "Loading…",
        sessionExpired: "Session expired. Please log in again.",
        errorLoad: "Error: {message}",
        emptyPending: "No pending approvals.",
        emptyActivity: "No referral activity found.",
        statusBadgePending: "Awaiting approval",
        statusShortInvited: "Invited",
        statusShortRegistered: "Registered",
        statusShortTreated: "Treated",
        statusShortRewarded: "Rewarded",
        registrationRate: "{percent}% registration rate",
        morePatients: "+{count} more",
        unknownReferrer: "Unknown",
        requestFailed: "Request failed",
        discountErrorHint: "Set referral discount percentages in Clinic Settings.",
        defaultDiscounts: "Default discounts: Inviter %{inviter}%, Invited %{invited}%",
        defaultDiscountsRequired: "⚠️ Default discount percentages must be entered in Clinic Settings page.",
        status: {
          PENDING: "Pending",
          APPROVED: "Approved",
          REJECTED: "Rejected"
        },
        errors: {
          noToken: "⚠️ Admin token not found. Please login as admin.",
          invalidToken: "❌ Admin token invalid or expired. Please enter admin token.",
          loadFailed: "Failed to load referrals.",
          approveFailed: "Approval error: {error}",
          rejectFailed: "Rejection error: {error}"
        }
      },
      marketplaceProfile: {
        title: "Clinifly Admin – Directory Profile",
        pageTitle: "Public Directory Profile",
        subtitle: "Manage how your clinic appears in Clinifly's user-facing directory. Reputation data is self-managed — enter your Google and Trustpilot details manually. Verified, featured, and sponsored badges are set by Clinifly.",
        loading: "Loading profile…",
        loadFailed: "Failed to load",
        saving: "Saving…",
        saved: "Profile saved.",
        saveFailed: "Save failed",
        saveBtn: "Save profile",
        reloadBtn: "Reload",
        sectionCompletion: "Profile completion",
        sectionCompletionHint: "Richer profiles help users compare and trust your clinic.",
        completed: "Completed",
        missing: "Missing",
        nothingYet: "Nothing yet",
        allDone: "All done",
        publishTitle: "Publish to public directory",
        publishHint: "Required: logo, description, country, ≥1 specialty, ≥1 language, website or social link",
        sectionBadges: "Platform badges",
        sectionBadgesHint: "Admin-only — contact Clinifly to request changes.",
        sectionReputation: "Reputation & Trust",
        sectionReputationHint: "Self-managed — copy values from your Google Business, Facebook Page, and Trustpilot profiles.",
        sectionGoogleReviews: "Google Reviews",
        sectionFacebookReviews: "Facebook Reviews",
        sectionTrustpilotReviews: "Trustpilot Reviews",
        facebookReviewsHelp: "Open your Facebook Page and copy the page URL. Enter your recommendation score and recommendation count from Facebook.",
        reputationPreviewLabel: "User-facing preview",
        reputationPreviewEmpty: "Enter scores above to see a preview here.",
        sectionSocial: "Social & Web",
        sectionClinicInfo: "Clinic Information",
        sectionMedia: "Media",
        sectionMediaHint: "Paste public image/video URLs (one per line in galleries).",
        locationHint: "Same location as Settings → used for clinic discovery filters.",
        listedButMissing: "Listed but missing requirements: {items}",
        toPublishComplete: "To publish, complete: {items}",
        fields: {
          googleBusinessUrl: "Google Business URL",
          googleRating: "Google Rating (0–5)",
          googleReviewCount: "Google Review Count",
          facebookPageUrl: "Facebook Page URL",
          facebookRecommendationScore: "Facebook Recommendation Score",
          facebookRecommendationCount: "Facebook Review / Recommendation Count",
          trustpilotUrl: "Trustpilot URL",
          trustpilotRating: "Trustpilot Rating (0–5)",
          trustpilotReviewCount: "Trustpilot Review Count",
          yearsInOperation: "Years in Operation",
          intlPatients: "International Users / Year",
          website: "Website",
          facebook: "Facebook",
          instagram: "Instagram",
          tiktok: "TikTok",
          youtube: "YouTube",
          linkedin: "LinkedIn",
          googleMaps: "Google Maps URL",
          shortDescription: "Short Description",
          aboutText: "About (optional longer text)",
          country: "Country",
          city: "City",
          languages: "Languages (comma-separated, e.g. English, Turkish, Russian)",
          specialties: "Specialties (comma-separated, e.g. Implantology, Aesthetic Dentistry)",
          logoUrl: "Logo URL",
          coverPhotoUrl: "Cover Photo URL",
          galleryPhotos: "Gallery Images (one URL per line)",
          beforeAfter: "Before / After Images (one URL per line)",
          videoUrls: "Video URLs (one per line)",
        },
        placeholders: {
          googleBusinessUrl: "https://g.page/…",
          facebookPageUrl: "https://www.facebook.com/yourclinic",
          facebookRecommendationScore: "96",
          facebookRecommendationCount: "145",
          trustpilotUrl: "https://www.trustpilot.com/review/…",
          shortDescription: "One line for search cards",
          aboutText: "Extended about section on profile page",
          city: "Tbilisi, Antalya, Istanbul…",
          galleryPhotos: "https://…",
          beforeAfter: "https://…",
          videoUrls: "https://youtube.com/…",
        },
        checklist: {
          logo: "Logo",
          description: "Description",
          website: "Website",
          googleRating: "Google Rating",
          languages: "Languages",
          specialties: "Specialties",
          clinicPhotos: "Clinic Photos",
          video: "Video",
          doctorProfiles: "Doctor Profiles",
          coverPhoto: "Cover Photo",
          country: "Country",
          city: "City",
          specialty: "At least 1 specialty",
          language: "At least 1 language",
          websiteOrSocial: "Website or social media link",
        },
        badges: {
          verified: "Verified",
          featured: "Featured",
          placement: "Placement",
          featuredUntil: "Featured until",
          yes: "Yes",
          no: "No",
        },
        tiers: {
          standard: "Standard",
          featured: "Featured",
          sponsored: "Sponsored",
        },
        countries: {
          "": "Select country",
          GE: "Georgia",
          TR: "Turkey",
          GB: "United Kingdom",
          DE: "Germany",
          US: "United States",
          AE: "United Arab Emirates",
          AZ: "Azerbaijan",
          AM: "Armenia",
          RU: "Russia",
          UA: "Ukraine",
          FR: "France",
          IT: "Italy",
          ES: "Spain",
          NL: "Netherlands",
          SA: "Saudi Arabia",
          IL: "Israel",
        },
      },
      successCenter: {
        title: "Clinifly Admin – Success Center",
        pageTitle: "Clinic Success Center",
        subtitle: "Complete your setup to increase visibility and receive more user inquiries. Follow the recommendations below — like having a success manager on your team.",
        loading: "Loading your success plan…",
        loadFailed: "Could not load",
        profileCompletion: "Profile",
        completionHeading: "Profile Completion",
        completionHint: "{done} of {total} items complete",
        sectionRecommendations: "Smart Recommendations",
        sectionRecommendationsHint: "Personalized next steps based on what's missing from your profile.",
        sectionGuidance: "Messages from Clinifly",
        sectionGuidanceHint: "Setup guidance from our team.",
        sectionGuidanceUnreadHint: "You have unread messages — please review the guidance below.",
        newMessage: "New message",
        sectionCampaign: "Onboarding Roadmap",
        sectionCampaignHint: "Coming soon: automated onboarding campaigns (Day 1 logo, Day 3 Google Reviews…).",
        whyItMatters: "Why it matters",
        allRecommendationsDone: "Excellent! Your profile is complete — you're ready for user inquiries.",
        noGuidanceYet: "No guidance messages yet.",
        markRead: "Mark read",
        items: {
          logo: "Logo",
          description: "Description",
          doctors: "Doctors",
          photos: "Photos",
          googleReviews: "Google Reviews",
          facebookReviews: "Facebook Reviews",
          socialLinks: "Social Links",
          languages: "Languages",
          aiSetup: "AI Setup",
        },
        readiness: {
          ready: "Ready for inquiries",
          almost: "Almost there",
          started: "Getting started",
          needsSetup: "Needs setup",
        },
        campaign: {
          dayLabel: "Day {day}",
          completed: "Completed",
          due: "Do now",
          upcoming: "Upcoming",
          scheduled: "Scheduled",
        },
      },
      helpCenter: {
        pageTitle: "Getting Started with Clinifly",
        subtitle: "Step-by-step guides to set up your clinic, complete your profile, connect doctors and users, and start receiving inquiries. No technical jargon — just what you need to get to 100% profile completion.",
        searchPlaceholder: "Search help articles…",
        searchNoResults: "No articles match your search. Try different words or browse the sections.",
        checklistTitle: "Quick setup checklist",
        checklistHint: "Follow this order to start receiving users as fast as possible.",
        topicsTitle: "Topics",
        showAll: "Show all topics",
        supportText: "Still stuck?",
        videoLink: "Watch tutorial videos",
        whatLabel: "What is it?",
        whyLabel: "Why should I use it?",
        howLabel: "How do I set it up?",
        tipsLabel: "Tips",
        openPage: "Open related page",
        screenshotCaption: "Example screen — your admin may look slightly different.",
        dashboardBannerTitle: "Getting Started with Clinifly",
        dashboardBannerDesc: "Complete setup guides for your clinic profile, doctors, users, AI, and more — written for clinic owners, not developers.",
        dashboardBannerBtn: "Open Help Center →",
        settingsBanner: "Need help with clinic setup, AI, or referrals? Visit the Help Center for step-by-step guides.",
        openLink: "Open Help Center →",
        profileGuideLink: "📖 Complete your public profile — step-by-step guide",
        googleGuideLink: "Google Reviews guide",
        checklist: {
          register: "Register clinic",
          settings: "Clinic info (Settings)",
          aiTraining: "AI Training Center",
          prices: "Treatment price list",
          directory: "Directory profile",
          doctors: "Approve doctors",
          leadInbox: "Lead inbox assignment",
          whatsapp: "Connect WhatsApp",
          invitePatients: "User invite link",
        },
        sections: {
          "create-clinic": { title: "Create Your Clinic", subtitle: "Registration, approval, and updating clinic info" },
          "connect-doctors": { title: "Connect Doctors", subtitle: "Invite, join, approve, and roles" },
          "add-patients": { title: "Add Users", subtitle: "Join, approve, invite, and doctor assignment" },
          "public-profile": { title: "Complete Your Public Profile", subtitle: "Logo, description, photos, specialties, and languages" },
          "google-reviews": { title: "Google Reviews", subtitle: "Add your Google Business profile to Clinifly" },
          "social-media": { title: "Social Media Links", subtitle: "Website, Instagram, Facebook, and more" },
          "ai-assistant": { title: "AI Assistant", subtitle: "Enable AI, WhatsApp, and Messenger" },
          "international-patients": { title: "International Users", subtitle: "Discovery, multilingual chat, and treatment requests" },
          "referral-system": { title: "Referral System", subtitle: "Friend invites and clinic benefits" },
          faq: { title: "Frequently Asked Questions", subtitle: "Quick answers" },
        },
      },
      timeline: {
        tooth: "Tooth",
        procedure: "Procedure",
        status: "Status"
      },
      date: {
        monthsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
      },
      files: {
        pageTitle: "Admin – User Files",
        title: "📁 User Files",
        selectPatient: "User:",
        selectPlaceholder: "Select user...",
        filterAll: "All",
        filterPhoto: "📸 Photos",
        filterXray: "🦷 X-Rays",
        filterPdf: "📄 PDF",
        filterChat: "💬 Chat",
        upload: "Upload",
        empty: "No files found.",
        selectToView: "Select a user to view their files.",
        badgeImage: "Photo",
        badgeXray: "X-Ray",
        badgePdf: "PDF",
        badgeFile: "File",
        badgeChat: "Chat",
        download: "Download"
      },
      doctorListV2: {
        pageTitle: "👨‍⚕️ Doctors",
        documentTitle: "Doctors - Clinifly Admin",
        statPending: "Pending",
        statApproved: "Approved",
        statRejected: "Rejected",
        statTotal: "Total",
        searchPlaceholder: "Search by name, email or phone...",
        filterAll: "All statuses",
        filterOptionPending: "Pending",
        filterOptionApproved: "Approved",
        filterOptionActive: "Active",
        filterOptionRejected: "Rejected",
        refresh: "↺ Refresh",
        loading: "Loading...",
        empty: "No doctor records yet.",
        errorHttp: "HTTP {status}",
        errorLoad: "Failed to load",
        sectionProfessional: "Professional",
        labelExperience: "Experience",
        labelUniversity: "University",
        labelGraduation: "Graduation",
        labelProfile: "Profile",
        labelBio: "Bio",
        profilePublic: "🌐 Public",
        profilePrivate: "🔒 Private",
        sectionSpecialty: "Specialty",
        sectionLanguages: "Languages",
        sectionProcedures: "Procedures",
        notSpecified: "Not specified",
        yearsCount: "{years} yrs",
        dash: "—",
        status: {
          PENDING: "Pending",
          APPROVED: "Approved",
          ACTIVE: "Active",
          REJECTED: "Rejected"
        },
        btnApprove: "✅ Approve",
        btnReject: "❌ Reject",
        confirmApprove: "Are you sure you want to approve this doctor?",
        confirmReject: "Are you sure you want to reject this application?",
        approvedAlert: "✅ Doctor approved!",
        rejectedAlert: "Application rejected.",
        errorGeneric: "Error"
      },
      chat: {
        documentTitle: "Chat - Clinifly Admin",
        pageHeading: "💬 Clinifly Admin – Chat",
        title: "Messages",
        patientsHeading: "Users",
        loading: "Loading...",
        selectPatient: "Select a user",
        noPatients: "No users yet",
        unnamed: "Unnamed",
        placeholder: "Type a message...",
        send: "Send",
        sending: "Sending...",
        noMessages: "No messages yet",
        newMessage: "New message",
        youJoined: "You joined the chat",
        photo: "Photo",
        file: "File",
        photoFile: "📷 Photo",
        fileAttach: "📎 File",
        download: "Download",
        uploadHelp: "Supported: JPG, PNG, HEIC (max 10MB) • PDF/DOC/DOCX/TXT/XLS/XLSX (max 20MB) • ZIP (max 50MB)",
        sentOk: "✓ Sent",
        uploadError: "✗ Error",
        errNoToken: "❌ No admin token. Please sign in first.",
        errTokenList: "Admin token required",
        errAuth: "❌ Authorization error. Please sign in again.",
        errAuthShort: "❌ Authorization error",
        errUnknown: "Unknown error",
        errLoadList: "❌ Could not load users: {message}",
        errLoadMessages: "Could not load messages",
        errLoadMessagesFull: "❌ Could not load messages: {message}",
        errSelectFirst: "❌ Please select a user first",
        errNoTokenSend: "❌ No admin token",
        errSend: "Could not send message",
        errSendFull: "❌ Could not send message: {message}",
        errFileUpload: "❌ Could not upload file: {message}",
        errSession: "❌ Your session has expired. Refresh and sign in again.",
        errForbidden: "❌ File type not allowed: {ext}. RAR and executables are blocked.",
        errMime: "❌ Could not detect file type. Try another file.",
        errImageFmt: "❌ Allowed: JPG, PNG, HEIC – Max 10MB",
        errDocFmt: "❌ Allowed: PDF, DOC/DOCX, TXT, XLS/XLSX, ZIP",
        errPhotoSize: "❌ Photo must be under 10MB",
        errZipSize: "❌ ZIP must be under 50MB",
        errDocSize: "❌ Document must be under 20MB",
        errSelectPatient: "❌ Please select a user first",
        before: "Before",
        after: "After",
        doctorReview: "👨‍⚕️ Doctor review",
        defaultClinic: "Clinic",
        defaultPhoto: "Photo",
        defaultFile: "File",
        navClinicSettings: "Clinic settings",
        patientAssignedBanner: "This user is assigned to Dr. {doctorName}.",
      },
      leads: {
        documentTitle: "Lead management — Clinifly Admin",
        pageTitle: "Lead inbox",
        subtitle:
          "One primary responder per lead thread. Clinic staff keep shared visibility from Messages.",
        backDashboard: "← Dashboard",
        refreshList: "Refresh list",
        statusLoading: "Loading…",
        statusUnassigned: "{count} threads",
        thPatient: "User",
        thContact: "Contact",
        thPreview: "Last message",
        thAssign: "Assign doctor",
        thPrimary: "Primary doctor",
        thLastActivity: "Last activity",
        thStatus: "Status",
        thActions: "Actions",
        empty: "No lead threads.",
        selectDoctor: "Select doctor…",
        assign: "Assign",
        reassign: "Reassign",
        unassign: "Unassign",
        openChat: "Open thread",
        badgeUnassigned: "Unassigned",
        badgePrimarySet: "Primary set",
        primaryNone: "—",
        confirmUnassign: "Remove primary doctor assignment for this lead?",
        successUnassigned: "Unassigned.",
        errChooseDoctor: "Choose a doctor first.",
        successAssigned: "Assigned successfully.",
        errLoad: "Load error",
        showAssignedToggle: "Show assigned threads",
        assignedBadgePrefix: "Dr.",
        assignedOk: "Assigned:",
        assignDisabledHint: "This lead already has a primary doctor.",
        autoAssignAll: "Auto-assign all unassigned",
        autoAssignSelected: "Auto-assign selected",
        autoAssignRunning: "Running auto-assign…",
        autoAssignDone: "Assigned: {assigned}, skipped: {skipped}, failed: {failed}.",
        autoAssignDistributionPrefix: "Distribution:",
        autoAssignPartialFail: "Some assignments failed:",
        autoAssignAllConfirm: "Assign all unassigned leads in this clinic using balanced distribution?",
        autoAssignNoneSelected: "Select at least one unassigned lead row.",
        selectAllUnassignedTitle: "Select all unassigned rows on this page",
        leadRoutingSectionTitle: "New lead routing",
        leadRoutingHelp:
          "Applies when a new lead thread is created. Does not change existing threads or manual assignment.",
        leadRoutingEnable: "Enable automatic primary assignment for new leads",
        leadRoutingMode: "Routing mode",
        leadRoutingModeManual: "Manual only — stay unassigned",
        leadRoutingModeFixed: "Fixed doctor",
        leadRoutingModeRoundRobin: "Round robin (eligible doctors)",
        leadRoutingModeBalanced: "Balanced (least assigned leads)",
        leadRoutingFixedDoctor: "Fixed doctor",
        leadRoutingSave: "Save routing settings",
        leadRoutingSaved: "Routing settings saved.",
        leadRoutingLoadError: "Could not load routing settings.",
        leadRoutingTableMissing: "Table clinic_lead_routing_settings is missing; apply the database migration.",
        tabNeedsAssignment: "Needs assignment",
        tabRecentlyRouted: "Recently routed",
        tabAssigned: "Assigned",
        thChannel: "Channel",
        thAssignedAt: "Assigned",
        searchPlaceholder: "Search user, phone, message…",
        channelMessenger: "Messenger",
        channelWhatsapp: "WhatsApp",
        channelWeb: "Web",
        channelUnknown: "Other",
        emptyNeedsAssignment: "No leads waiting for manual assignment.",
        emptyRecentRouted: "No auto-routed leads in the last 24 hours.",
        emptyAssigned: "No assigned leads.",
        statusNeedsAssignment: "{count} leads need assignment",
        statusRecentRouted: "{count} recently routed leads",
        statusAssigned: "{count} assigned leads",
        badgeNewRouted: "Newly routed",
      },
    },

    ru: {
      common: {
        loading: "Загрузка...", save: "Сохранить", cancel: "Отмена", delete: "Удалить",
        edit: "Редактировать", search: "Поиск", filter: "Фильтр", close: "Закрыть",
        back: "Назад", next: "Далее", previous: "Предыдущий", submit: "Отправить",
        yes: "Да", no: "Нет", ok: "ОК", error: "Ошибка", success: "Успешно", warning: "Предупреждение",
        doctor: "Врач"
      },
      adminPages: {
        travelH1: "✈️ Clinifly Admin — Поездки",
        travelGlobalWarning: "⚠️ ВНИМАНИЕ: часть полей заполняет пользователь. Проверьте подсказки ниже.",
        travelWordHotel: "Отель",
        travelWordFlights: "Рейсы",
        travelListSeparator: " и ",
        travelDynamicWarning: "⚠️ ВНИМАНИЕ: пользователь заполнит данные: {list}. Эти поля нельзя менять. Пользователь внесёт их в мобильном приложении.",
        healthH1: "🩺 Clinifly Admin — Здоровье",
        doctorApplicationsH1: "Заявки врачей",
        doctorAppsStatPending: "Ожидают",
        doctorAppsStatApproved: "Одобрено",
        doctorAppsStatRejected: "Отклонено",
        doctorAppsStatTotal: "Всего",
        doctorAppsLoading: "Загрузка врачей...",
        doctorAppsEmptyTitle: "Врачей пока нет",
        doctorAppsEmptyDesc: "Заявок ещё не было.",
        activePatientsH1: "👨‍⚕️ Активные пользователи",
        activePatientsStatActive: "Активные",
        activePatientsStatPending: "В ожидании",
        activePatientsStatTotal: "Всего пользовательов",
        activePatientsStatClinic: "Клиник",
        activePatientsSearchPlaceholder: "Поиск по имени, email или телефону...",
        activePatientsAllClinics: "Все клиники",
        activePatientsRefresh: "🔄 Обновить",
        activePatientsLoading: "🔄 Загрузка...",
        activePatientsEmpty: "Активных пользовательов пока нет",
        treatmentCreateH1: "🏥 Создать лечение",
        treatmentCreateSubtitle: "Создайте группу лечения и назначьте врачей",
        patientDetailH1: "Карта пользовательа",
        patientDetailBack: "Назад",
        legacyNavClinics: "Клиники"
      },
      dashboard: {
        title: "Clinifly Admin – Панель управления",
        sidebar: {
          mainMenu: "Главное меню",
          management: "Управление",
          logout: "Выход",
          clinic: "Клиника"
        },
        nav: { dashboard: "Панель", patients: "Пациенты", invitePatients: "Пригласить пациентов", travel: "Поездки", treatment: "Лечение", schedule: "Расписание", doctors: "Врачи", chat: "Чат", leads: "Входящие лидов", leadsNeedsAssignment: "Требуют назначения", leadsRecentlyRouted: "Недавно направленные", leadsAssigned: "Назначенные", aiLeads: "Центр координации", files: "Файлы", referrals: "Рефералы", marketplaceProfile: "Профиль в каталоге", helpCenter: "Справочный центр", learningCandidates: "Обучение ИИ", health: "Здоровье", settings: "Настройки" },
        charts: {
          metricTitleMonthlyPatients: "Количество зарегистрированных пользовательов по месяцам",
          metricTitleMonthlyProcedures: "Количество процедур по месяцам",
          chartLabelMonthlyRegistered: "Регистрации по месяцам",
          activePatients: "Активные пользователи",
          procedures: "Процедуры",
          noData: "Нет данных",
          trendNote: "Тренд улучшится по мере накопления данных",
          vsPreviousMonth: "по сравнению с прошлым месяцем",
          noPreviousData: "Нет данных за предыдущий период",
          summaryActivePatients: "{count} активных пользовательов • {month}",
          summaryMonthlyRegistered: "{count} регистраций • {month}",
          summaryProcedures: "{count} процедур • {month}"
        },
        upcoming: {
          title: "📅 Расписание клиники",
          subtitle: "Все события (прошлые и будущие)",
          empty: "Нет предстоящих событий",
          today: "Сегодня",
          tomorrow: "Завтра",
          dayAfterTomorrow: "Послезавтра",
          daysLater: "Через {count} дн.",
          weeksLater: "Через {count} нед.",
          overdue: "⚠️ Просрочено: {count}",
          overdueDesc: "У вас {count} просроченных событий, требующих внимания.",
          status: { planned: "Запланировано", done: "Выполнено" },
          summary: { overdue: "Просрочено:", today: "Сегодня:", tomorrow: "Завтра:", patients: "пациентов", events: "событий" },
          eventTypes: {
            TRAVEL_EVENT: "Туристическое мероприятие",
            FLIGHT: "Рейс",
            HOTEL: "Отель",
            AIRPORT_PICKUP: "Трансфер из аэропорта",
            TREATMENT: "Лечение",
            CONSULT: "Консультация",
            FOLLOWUP: "Контрольный осмотр",
            LAB: "Лаборатория / Сканирование",
            HEALTH: "Форма здоровья",
            APPOINTMENT: "Запись",
            PAYMENT: "Оплата",
            SURGERY: "Хирургия",
            CHECKUP: "Осмотр"
          }
        },
        planUsage: "План и использование",
        activeTreatments: "Активные процедуры",
        monthlyUploads: "Ежемесячные загрузки",
        referralInvites: "Реферальные приглашения",
        totalReferrers: "Всего рефереров",
        patientRoster: "Пользователи (лимит списка)",
        usagePeriodNote: "Месячное окно использования (UTC): {period}",
        usageFreshness: "Данные на момент: {time}",
        upgrade: "Повысить тариф",
        unlimited: "Безлимит",
        planAlertCrit: "Достигнут лимит. Повысьте тариф, чтобы продолжить.",
        planAlertWarn: "Вы близки к лимиту",
        planTierTitle: "Текущий тариф",
        confirmOpenPricing: "Открыть страницу с ценами?\n\n{url}",
        metricsErrorHint: "См. консоль браузера (F12)"
      },
      calendar: {
        documentTitle: "Календарь - Clinifly Admin",
        pageTitle: "Календарь записей",
        title: "Календарь записей",
        weekRangeTitle: "Диапазон недель",
        today: "Сегодня",
        week: "Неделя",
        month: "Месяц",
        prev: "← Назад",
        previous: "← Назад",
        next: "Вперёд →",
        timeColumn: "Время",
        doctor: "Врач",
        chair: "Кресло",
        allDoctors: "Все врачи",
        allChairs: "Все кресла",
        noEvents: "Нет событий",
        noAppointmentsForWeek: "Нет записей на выбранную неделю.",
        noAppointmentsForRange: "Нет записей в выбранном периоде.",
        summaryLine: "{count} приёмов • {doctorCount} врачей • {chairCount} кресел",
        loading: "Загрузка...",
        tokenMissing: "Нет токена админа. Войдите снова.",
        sessionExpired: "Сессия истекла. Переход к входу...",
        fetchFailed: "Не удалось загрузить записи: {message}",
        doctorNotFound: "Врач не найден",
        chairWithNumber: "Кресло {n}"
      },
      pricing: {
        title: "Тарифы Clinifly",
        subtitle: "Гибкие планы по числу активных пользовательов",
        info: "Платите только за количество активных пользовательов.",
        periodMonthly: "/месяц",
        free: {
          name: "Free",
          patients: "5 пользовательов",
          description: "Попробуйте Clinifly с реальными пользовательами.",
          cta: "Начать"
        },
        basic: {
          name: "Pro",
          badge: "Популярно",
          patients: "15 пользовательов",
          description: "Сильный пакет для растущих клиник.",
          cta: "Обновить"
        },
        pro: {
          name: "Premium",
          patients: "Безлимит пользовательов",
          description: "Премиум-поддержка для крупных клиник.",
          cta: "Обновить",
          contactCta: "Связаться"
        },
        features: {
          allCore: "Все базовые функции",
          patientCommunication: "Коммуникация с пользовательами",
          fileSharing: "Обмен файлами",
          referral: "Реферальная система",
          branding: "Брендинг Clinifly",
          customBranding: "Кастомный брендинг",
          analytics: "Аналитика",
          support: "Поддержка по email",
          unlimitedPatients: "Безлимит пользовательов",
          advancedReferral: "Расширенные рефералы (уровни, кампании)",
          prioritySupport: "Приоритетная поддержка",
          onboarding: "Онбординг-поддержка"
        },
        comparison: {
          feature: "Функция",
          free: "Free",
          basic: "Pro",
          pro: "Premium",
          patients: "Активные пользователи",
          unlimited: "Безлимит",
          coreFeatures: "Базовые функции",
          branding: "Брендинг Clinifly",
          customBranding: "Кастомный брендинг",
          referral: "Реферальная система",
          advancedReferral: "Расширенные рефералы",
          analytics: "Аналитика",
          support: "Поддержка",
          community: "Сообщество",
          email: "Email",
          priority: "Приоритетная"
        },
        faq: {
          title: "Частые вопросы",
          q1: {
            question: "Как считается число активных пользовательов?",
            answer: "Учитываются только APPROVED (активные) пользователи. Pending, rejected и cancelled не входят в лимит."
          },
          q2: {
            question: "Что будет при достижении лимита?",
            answer: "С текущими пользовательами можно продолжать работу. Ограничивается только одобрение новых пользовательов."
          },
          q3: {
            question: "Можно ли сменить план?",
            answer: "Да, вы можете повысить или понизить план в любое время."
          },
          q4: {
            question: "Какие способы оплаты принимаются?",
            answer: "Мы принимаем банковские карты, банковские переводы и локальные способы оплаты."
          }
        },
        contact: {
          title: "Нужны особые условия?",
          description: "Для крупных клиник доступны индивидуальные планы.",
          button: "Связаться"
        }
      },
      login: { title: "Вход в Clinifly Admin", clinicCode: "Код клиники", password: "Пароль", login: "Войти", loading: "Загрузка...", error: "Ошибка входа", invalidCredentials: "Неверный код клиники или пароль.", sessionExpired: "⏰ Срок сессии истёк или токен недействителен. Пожалуйста, войдите снова." },
      auth: { email: "Эл. почта", password: "Пароль", confirm_password: "Подтвердите пароль", name: "Имя и фамилия" },
      register: {
        clinicCode: "Код клиники",
        clinicCodeWhat: "Что такое код клиники?",
        clinicCodeHelp: "Код клиники — это короткий уникальный символ вашей клиники, как аббревиатура или знак. Вы выбираете его при регистрации; пользователи вводят этот код в приложении, чтобы связаться с вами.",
        clinicCodeTip1: "3–12 символов; только заглавные буквы и цифры (напр. CEM, ELKO, MOON)",
        clinicCodeTip2: "Возьмите из названия клиники или придумайте запоминающийся символ",
        clinicCodeTip3: "Это не ваш пароль — код можно сообщать пользовательам",
        clinicCodePlaceholder: "напр. CEM, ELKO, MOON",
        clinicCodeHint: "Примеры: CEM, ELKO, SMILE",
      },
      patients: {
        title: "Clinifly Admin – Пользователи",
        search: "Поиск пользовательов...",
        filter: "Фильтр",
        registeredPatients: "Зарегистрированные пользователи",
        searchPlaceholder: "Поиск: имя / телефон / patientId / clinicCode",
        filterAll: "Все",
        clearFilters: "Сбросить",
        refresh: "Обновить",
        loading: "Загрузка...",
        noResults: "Нет результатов",
        selectedPatient: "Выбранный пользователь: {name}",
        patientId: "ID пациента: {id}",
        copyId: "Копировать ID",
        copyIdSuccess: "✅ ID пользовательа скопирован",
        clear: "Очистить",
        travel: "Поездки",
        treatment: "Лечение",
        health: "Здоровье",
        chat: "Чат",
        files: "📁 Файлы",
        approve: "Одобрить",
        approveConfirm: "Одобрить этого пациента? ({patientId})",
        approveSuccess: "✅ Пользователь одобрен",
        addPatient: "➕ Добавить пользовательа",
        addPatientTitle: "Новый пользователь",
        firstName: "Имя *",
        lastName: "Фамилия *",
        email: "Эл. почта",
        dateOfBirth: "Дата рождения",
        address: "Адрес",
        notes: "Заметки",
        cancel: "Отмена",
        add: "Добавить",
        addSuccess: "✅ Пользователь успешно добавлен",
        addError: "❌ Не удалось добавить пользовательа",
        assignDoctorLabel: "Назначить врача:",
        assignButton: "Назначить",
        selectDoctorPlaceholder: "Выберите врача",
        noDoctorAssigned: "Врач не назначен",
        before: "До",
        after: "После",
        phone: "Телефон",
        status: { PENDING: "Ожидание", APPROVED: "Одобрено" },
        errors: {
          noToken: "⚠️ Токен администратора не найден. Войдите снова.",
          unauthorized: "❌ Ошибка авторизации. Войдите снова.",
          loadFailed: "❌ Не удалось загрузить список пользовательов: {error}",
          approveFailed: "❌ Ошибка одобрения: {error}",
          patientLimitReached: "⚠️ Достигнут лимит активных пользовательов. Обновите тариф, чтобы добавлять новых.",
          patientLimitReachedTitle: "Лимит пользовательов"
        },
        limits: {
          title: "Лимит активных пользовательов",
          message: "В вашем тарифе {current}/{limit} активных пользовательов.",
          upgradeMessage: "Обновите тариф, чтобы добавлять новых пользовательов.",
          upgradeButton: "Обновить тариф",
          continueButton: "Продолжить с текущими пользовательами"
        }
      },
      referrals: {
        title: "🎁 Clinifly Admin – Рефералы",
        referrals: "Рефералы",
        filterAll: "Все",
        refresh: "↻ Обновить",
        loading: "Загрузка...",
        noReferrals: "Рефералы не найдены.",
        inviter: "Пригласивший",
        invited: "Приглашённый",
        createdAt: "Создано",
        inviterDiscount: "Скидка пригласившего",
        invitedDiscount: "Скидка приглашённого",
        discount: "Скидка",
        approve: "Одобрить",
        reject: "Отклонить",
        approveConfirm: "Вы уверены, что хотите одобрить?",
        rejectConfirm: "Вы уверены, что хотите отклонить?",
        approved: "Реферал одобрен ✅",
        rejected: "Реферал отклонён ✅",
        found: "{count} рефералов найдено.",
        activityPageTitle: "🎁 Реферальная активность",
        statTotalReferrers: "Всего пригласивших",
        statInvitedUtcMonth: "Приглашено в этом UTC-месяце",
        statInvitedUtcMonthTitle: "Как в Плане и использовании → Реферальные приглашения (биллинг / SaaS)",
        statTotalInvitedAllTime: "Всего приглашено (за всё время)",
        statRegistered: "Зарегистрировано",
        statTreated: "Прошли лечение",
        statPending: "Ожидают одобрения",
        pendingSectionTitle: "Рефералы, ожидающие одобрения",
        thStatus: "Статус",
        thCode: "Код",
        thDate: "Дата",
        thActions: "Действия",
        summaryTitle: "Сводка по пригласившим",
        filterAllStatuses: "Все статусы",
        filterRegisteredOpt: "Зарегистрирован",
        filterTreatedOpt: "Лечение",
        filterRewardedOpt: "Награждён",
        thReferrer: "Пригласивший",
        thInvitedCount: "Приглашено",
        thRegisteredCount: "Зарегистр.",
        thTreatedCount: "Лечение",
        thInvitedPatients: "Приглашённые пользователи",
        loadingMain: "Загрузка…",
        sessionExpired: "Сессия истекла. Войдите снова.",
        errorLoad: "Ошибка: {message}",
        emptyPending: "Нет ожидающих одобрения.",
        emptyActivity: "Реферальная активность не найдена.",
        statusBadgePending: "Ожидает одобрения",
        statusShortInvited: "Приглашён",
        statusShortRegistered: "Зарегистрирован",
        statusShortTreated: "Лечение",
        statusShortRewarded: "Награждён",
        registrationRate: "{percent}% конверсия в регистрацию",
        morePatients: "ещё +{count}",
        unknownReferrer: "Неизвестно",
        requestFailed: "Запрос не выполнен",
        discountErrorHint: "Задайте проценты скидки в настройках клиники (Clinic Settings).",
        defaultDiscounts: "Скидки по умолчанию: пригласивший %{inviter}%, приглашённый %{invited}%",
        defaultDiscountsRequired: "⚠️ Введите проценты скидок на странице настроек клиники.",
        status: { PENDING: "Ожидание", APPROVED: "Одобрено", REJECTED: "Отклонено" },
        errors: {
          noToken: "⚠️ Токен не найден.",
          loadFailed: "Ошибка загрузки.",
          approveFailed: "Ошибка: {error}",
          rejectFailed: "Ошибка: {error}",
        },
      },
      marketplaceProfile: {
        title: "Clinifly Admin – Профиль в каталоге",
        pageTitle: "Публичный профиль в каталоге",
        subtitle: "Управляйте тем, как ваша клиника отображается в каталоге Clinifly для пользовательов. Данные репутации вводятся клиникой — Google и Trustpilot вручную. Значки Verified, Featured и Sponsored назначает Clinifly.",
        loading: "Загрузка профиля…",
        loadFailed: "Не удалось загрузить",
        saving: "Сохранение…",
        saved: "Профиль сохранён.",
        saveFailed: "Ошибка сохранения",
        saveBtn: "Сохранить профиль",
        reloadBtn: "Обновить",
        sectionCompletion: "Заполнение профиля",
        sectionCompletionHint: "Полные профили помогают пользовательам сравнивать и доверять клинике.",
        completed: "Готово",
        missing: "Не хватает",
        nothingYet: "Пока ничего",
        allDone: "Всё готово",
        publishTitle: "Опубликовать в каталоге",
        publishHint: "Нужно: логотип, описание, страна, ≥1 специализация, ≥1 язык, сайт или соцсеть",
        sectionBadges: "Значки платформы",
        sectionBadgesHint: "Только Clinifly — для изменений свяжитесь с Clinifly.",
        sectionReputation: "Репутация и доверие",
        sectionReputationHint: "Вводится клиникой — скопируйте с Google Business, Facebook Page и Trustpilot.",
        sectionGoogleReviews: "Отзывы Google",
        sectionFacebookReviews: "Отзывы Facebook",
        sectionTrustpilotReviews: "Отзывы Trustpilot",
        facebookReviewsHelp: "Откройте страницу Facebook и скопируйте URL. Введите процент рекомендаций и их количество.",
        reputationPreviewLabel: "Предпросмотр для пользовательов",
        reputationPreviewEmpty: "Введите оценки выше, чтобы увидеть предпросмотр.",
        sectionSocial: "Соцсети и сайт",
        sectionClinicInfo: "Информация о клинике",
        sectionMedia: "Медиа",
        sectionMediaHint: "Вставьте публичные URL изображений/видео (по одному в строке).",
        locationHint: "Та же локация, что в Настройках → для фильтров поиска клиник.",
        listedButMissing: "Опубликовано, но не хватает: {items}",
        toPublishComplete: "Для публикации заполните: {items}",
        fields: {
          googleBusinessUrl: "URL Google Business",
          googleRating: "Рейтинг Google (0–5)",
          googleReviewCount: "Количество отзывов Google",
          facebookPageUrl: "URL страницы Facebook",
          facebookRecommendationScore: "Процент рекомендаций Facebook",
          facebookRecommendationCount: "Количество отзывов / рекомендаций Facebook",
          trustpilotUrl: "URL Trustpilot",
          trustpilotRating: "Рейтинг Trustpilot (0–5)",
          trustpilotReviewCount: "Количество отзывов Trustpilot",
          yearsInOperation: "Лет работы",
          intlPatients: "Иностранных пользовательов в год",
          website: "Веб-сайт",
          facebook: "Facebook",
          instagram: "Instagram",
          tiktok: "TikTok",
          youtube: "YouTube",
          linkedin: "LinkedIn",
          googleMaps: "URL Google Maps",
          shortDescription: "Краткое описание",
          aboutText: "О клинике (длинный текст, необязательно)",
          country: "Страна",
          city: "Город",
          languages: "Языки (через запятую, напр. English, Turkish, Russian)",
          specialties: "Специализации (через запятую, напр. Implantology, Aesthetic Dentistry)",
          logoUrl: "URL логотипа",
          coverPhotoUrl: "URL обложки",
          galleryPhotos: "Галерея (один URL на строку)",
          beforeAfter: "До / После (один URL на строку)",
          videoUrls: "URL видео (по одному на строку)",
        },
        placeholders: {
          googleBusinessUrl: "https://g.page/…",
          facebookPageUrl: "https://www.facebook.com/yourclinic",
          facebookRecommendationScore: "96",
          facebookRecommendationCount: "145",
          trustpilotUrl: "https://www.trustpilot.com/review/…",
          shortDescription: "Одна строка для карточек поиска",
          aboutText: "Расширенный раздел «О клинике» на странице профиля",
          city: "Тбилиси, Анталья, Стамбул…",
          galleryPhotos: "https://…",
          beforeAfter: "https://…",
          videoUrls: "https://youtube.com/…",
        },
        checklist: {
          logo: "Логотип",
          description: "Описание",
          website: "Веб-сайт",
          googleRating: "Рейтинг Google",
          languages: "Языки",
          specialties: "Специализации",
          clinicPhotos: "Фото клиники",
          video: "Видео",
          doctorProfiles: "Профили врачей",
          coverPhoto: "Обложка",
          country: "Страна",
          city: "Город",
          specialty: "Минимум 1 специализация",
          language: "Минимум 1 язык",
          websiteOrSocial: "Сайт или ссылка на соцсеть",
        },
        badges: {
          verified: "Проверено",
          featured: "Рекомендуемое",
          placement: "Размещение",
          featuredUntil: "Рекомендуемое до",
          yes: "Да",
          no: "Нет",
        },
        tiers: {
          standard: "Стандарт",
          featured: "Рекомендуемое",
          sponsored: "Спонсорское",
        },
        countries: {
          "": "Выберите страну",
          GE: "Грузия",
          TR: "Турция",
          GB: "Великобритания",
          DE: "Германия",
          US: "США",
          AE: "ОАЭ",
          AZ: "Азербайджан",
          AM: "Армения",
          RU: "Россия",
          UA: "Украина",
          FR: "Франция",
          IT: "Италия",
          ES: "Испания",
          NL: "Нидерланды",
          SA: "Саудовская Аравия",
          IL: "Израиль",
        },
      },
      helpCenter: {
        pageTitle: "Начало работы с Clinifly",
        subtitle: "Пошаговые инструкции по настройке клиники, профиля, врачей, пользовательов и ИИ. Без технического жаргона — для владельцев клиник.",
        searchPlaceholder: "Поиск в справке…",
        searchNoResults: "Ничего не найдено. Попробуйте другие слова или просмотрите разделы.",
        checklistTitle: "Быстрый чеклист настройки",
        checklistHint: "Следуйте этому порядку, чтобы быстрее начать принимать пользовательов.",
        topicsTitle: "Темы",
        showAll: "Показать все темы",
        supportText: "Всё ещё нужна помощь?",
        videoLink: "Смотреть обучающие видео",
        whatLabel: "Что это?",
        whyLabel: "Зачем это нужно?",
        howLabel: "Как настроить?",
        tipsLabel: "Советы",
        openPage: "Открыть страницу",
        screenshotCaption: "Пример экрана — ваш интерфейс может немного отличаться.",
        dashboardBannerTitle: "Начало работы с Clinifly",
        dashboardBannerDesc: "Руководства по профилю клиники, врачам, пользовательам, ИИ и другому — для владельцев клиник.",
        dashboardBannerBtn: "Справочный центр →",
        settingsBanner: "Нужна помощь с настройкой, ИИ или рефералами? Откройте Справочный центр.",
        openLink: "Справочный центр →",
        profileGuideLink: "📖 Заполните публичный профиль — пошаговое руководство",
        googleGuideLink: "Руководство по отзывам Google",
        checklist: {
          register: "Регистрация клиники",
          settings: "Данные клиники (Настройки)",
          aiTraining: "Центр обучения ИИ",
          prices: "Прайс-лист",
          directory: "Профиль в каталоге",
          doctors: "Одобрение врачей",
          leadInbox: "Назначение во входящих",
          whatsapp: "Подключение WhatsApp",
          invitePatients: "Ссылка приглашения пользовательов",
        },
        sections: {
          "create-clinic": { title: "Создайте клинику", subtitle: "Регистрация, одобрение и обновление данных" },
          "connect-doctors": { title: "Подключите врачей", subtitle: "Приглашение, регистрация, одобрение и роли" },
          "add-patients": { title: "Добавьте пациентов", subtitle: "Присоединение, одобрение, приглашения" },
          "public-profile": { title: "Заполните публичный профиль", subtitle: "Логотип, описание, фото, специализации" },
          "google-reviews": { title: "Отзывы Google", subtitle: "Добавьте Google Business в Clinifly" },
          "social-media": { title: "Соцсети", subtitle: "Сайт, Instagram, Facebook и др." },
          "ai-assistant": { title: "ИИ-ассистент", subtitle: "Включение ИИ, WhatsApp и Messenger" },
          "international-patients": { title: "Иностранные пациенты", subtitle: "Поиск, языки и запросы на лечение" },
          "referral-system": { title: "Реферальная система", subtitle: "Приглашения друзей и выгода клиники" },
          faq: { title: "Частые вопросы", subtitle: "Быстрые ответы" },
        },
      },
      settings: {
        title: "⚙️ Настройки клиники",
        pageTitle: "⚙️ Clinifly Admin – Настройки",
        clinicInformation: "Информация о клинике",
        brandingNotice: "Настройки брендинга доступны только для плана PRO.",
        subscriptionPlan: "Тарифный план",
        subscriptionPlanHelp: "Здесь вы можете изменить план FREE / BASIC / PRO.",
        usageLoading: "Загрузка…",
        usageActiveTreatments: "Активные процедуры",
        usageMonthlyUploads: "Загрузки за месяц (UTC)",
        usageReferrals: "Реферальные приглашения (текущий UTC месяц)",
        usagePeriodNote: "Период учёта (UTC месяц): {period}",
        usagePatients: "Пользователи в списке",
        usageLoadFailed: "Не удалось загрузить использование.",
        usageFreshness: "Время снимка: {time}",
        currentPlan: "Текущий план: {plan}",
        planUpgrade: "Обновить план",
        planChangesNote: "Смена плана выполняется на странице тарифов.",
        locationTitle: "Местоположение",
        locationAllPlans: "ВСЕ ПЛАНЫ",
        countryLabel: "Страна",
        cityLabel: "Город",
        cityPlaceholder: "Antalya, Istanbul, London, Tbilisi...",
        locationDiscoveryHelp: "Пользователи могут фильтровать клиники по стране и городу.",
        selectCountry: "Выберите страну",
        countryRequiredAlert: "Выберите страну.",
        cityRequiredAlert: "Укажите город.",
        plan: "План",
        branding: "Брендинг",
        clinicName: "Название клиники",
        clinicLogoUrl: "URL логотипа клиники",
        clinicLogoUrlHelp: "Логотип отображается для плана Pro",
        chairCountLabel: "Количество кресел",
        chairCountHelp: "Сколько кресел показывать в календаре записей (напр.: 1, 2, 3).",
        address: "Адрес клиники",
        addressHelp: "Отображается на экране пользовательа для плана Pro",
        googleMapLink: "Ссылка Google Maps",
        googleMapLinkHelp: "Отображается на экране пользовательа для плана Pro",
        primaryColor: "Основной цвет (Hex)",
        secondaryColor: "Дополнительный цвет (Hex)",
        welcomeMessage: "Приветственное сообщение",
        referralDiscounts: "🎁 Реферальные скидки",
        referralDiscountsHelp: "Настройте процентные скидки для успешных рефералов.",
        referralDiscount: "Реферальная скидка (%)",
        referralDiscountHelp: "Скидка для пригласившего и приглашённого",
        aiCommunication: {
          title: "ИИ-коммуникация",
          desc: "Настройте скорость первого ответа в Messenger, Instagram и WhatsApp. Режим <strong>Мгновенно</strong> приветствует пользовательов за секунды. Режим <strong>Ждать человека</strong> включает ИИ, если команда не ответит в указанное время.",
          instant: "Мгновенные ответы ИИ (~1–5 сек в Messenger/WhatsApp)",
          waitHuman: "Сначала ждать ответа команды",
          humanOnly: "Только человек (без автоответа ИИ)",
          timingHintInstant:
            "Режим «Мгновенно»: ИИ отвечает примерно за 1–5 секунд. Задержка ниже (секунды) тонко настраивает скорость — не 30+ секунд тишины команды.",
          timingHintWait:
            "«Ждать человека»: если команда не ответит за указанное время, ИИ отправит первое сообщение. Мгновенного приветствия нет.",
          timingHintHumanOnly:
            "Без автоматических ответов ИИ в Messenger и WhatsApp — все сообщения обрабатывает ваша команда.",
          humanTakeoverLabel: "Тишина команды перед включением ИИ",
          secondsWord: "сек",
          omniDelayLabel: "Задержка мгновенного ответа (Messenger / WhatsApp)",
          omniDelayHelp:
            "Рекомендуется: 0,1–0,3 с для быстрых ответов. Более ~1 с кажется медленным. Только в режиме «Мгновенно».",
          fallbackHelp:
            "Только в режиме «Ждать человека»: ИИ отправляет первое сообщение, если команда молчит столько времени.",
          bookingModeLabel: "Режим записи в календаре ИИ",
          bookingDraft: "Черновик записи (подтверждение персонала) — рекомендуется",
          bookingSuggest: "Только предложение (без записи в календарь)",
          bookingAuto: "Полностью автоматическая запись (сразу подтверждена)",
          bookingHint: "ИИ проверяет доступность календаря, запрашивает телефон/WhatsApp перед записью и учитывает рабочие часы, буферы и обеденный перерыв.",
          clinicHoursLabel: "Рабочие часы клиники (расписание ИИ)",
          clinicOpenLabel: "Открытие",
          clinicCloseLabel: "Закрытие",
          clinicTimezoneLabel: "Часовой пояс клиники",
          clinicHoursHint: "ИИ предлагает слоты только в эти часы (местное время клиники). Пример: открытие 08:00 — не 07:00.",
          save: "Сохранить настройки ИИ",
          loading: "Загрузка…",
          signInRequired: "Войдите, чтобы настроить ИИ-коммуникацию.",
          loadFailed: "Не удалось загрузить настройки ИИ-коммуникации.",
          saving: "Сохранение…",
          saveFailed: "Ошибка сохранения: {error}",
          saved: "Сохранено. Messenger/WhatsApp будут использовать эти тайминги ответов.",
        },
        communicationChannels: {
          title: "Каналы связи",
          desc: "Подключите внешние каналы, чтобы сообщения пользовательов появлялись во входящих ИИ-координатора с бейджами источника (WhatsApp, Messenger, Instagram, Web).",
          whatsapp: "WhatsApp →",
          messenger: "Messenger →",
        },
        referralLevel1: "Уровень 1 (%)",
        referralLevel1Help: "Общая скидка после 1 успешного реферала",
        referralLevel2: "Уровень 2 (%)",
        referralLevel2Help: "Общая скидка после 2 успешных рефералов",
        referralLevel3: "Уровень 3 (%)",
        referralLevel3Help: "Максимальная скидка для 3+ рефералов",
        referralSettings: "🎯 Настройки рефералов",
        referralSettingsHelp: "Установите ставки заработка для реферальной системы.",
        referralPerInvite: "Заработок за приглашение (%)",
        referralPerInvitePlaceholder: "10",
        referralPerInviteHelp: "Скидка за каждый успешный реферал",
        referralMaxTotal: "Максимальная общая скидка (%)",
        referralMaxTotalPlaceholder: "10",
        referralMaxTotalHelp: "Максимальная скидка, которую может получить пригласивший.",
        temporaryPatientLimit: "🔧 Временный лимит пользовательов",
        temporaryPatientLimitHelp: "Добавьте временный лимит для процессов продаж. Добавляется поверх обычного лимита плана.",
        temporaryLimit: "Временный лимит",
        temporaryLimitPlaceholder: "Доп. кол-во пользовательов (напр.: 5)",
        saveTemporaryLimit: "Сохранить временный лимит",
        removeTemporaryLimit: "Удалить временный лимит",
        temporaryLimitActive: "Текущий временный лимит: +{count} пользовательов",
        referralPreviewLabel: "💡 Предпросмотр:",
        referralPreviewNone: "❌ Скидка применяться не будет",
        referralPreviewLow: "✅ <strong>Скидка {discount}%</strong> будет применена как пригласившему, так и приглашённому.<br><span style=\"color:#10b981\">💡 Отличная отправная точка для привлечения новых пользовательов!</span>",
        referralPreviewMid: "🎉 <strong>Скидка {discount}%</strong> для обеих сторон.<br><span style=\"color:#f59e0b\">⚠️ Больше скидка — привлекательнее рефералы!</span>",
        referralPreviewHigh: "🚀 <strong>Скидка {discount}%</strong> — Максимальный уровень!<br><span style=\"color:#ef4444\">⚠️ Очень щедро — проверьте прибыльность!</span>",
        save: "💾 Сохранить настройки",
        saveLoading: "Сохранение...",
        treatmentPriceList: "💰 Список цен на лечение",
        treatmentPriceListHelp: "Установите цены на лечение вашей клиники.",
        currency: "Валюта",
        loadingPrices: "Загрузка цен...",
        saveAllPrices: "💾 Сохранить все цены",
        tableHeaders: {
          treatment: "Процедура",
          price: "Цена",
          recommended: "Рекомендуется",
          duration: "Длительность (мин)",
          breakMin: "Перерыв (мин)",
          active: "Активно",
          options: "Опции",
        },
        categoryLabels: {
          EVENTS: "События",
          PROSTHETIC: "Ортопедия",
          RESTORATIVE: "Терапия",
          ENDODONTIC: "Эндодонтия",
          SURGICAL: "Хирургия",
          IMPLANT: "Имплантация"
        },
        recommendedDuration: "~{minutes} мин",
        minutes: "мин",
        opsProfileCardTitle: "Обучение ИИ клиники",
        opsProfileCardDesc: "Настройте, как ИИ представляет клинику, какие знания использует и как отвечает пользовательам.",
        opsProfileCardPricing: "Цены и варианты брендов — в <strong>прайс-листе лечения</strong> ниже.",
        opsProfileOpen: "Центр обучения ИИ →",
      },

      opsProfile: {
        pageTitle: "Обучение ИИ клиники — Clinifly Admin",
        title: "Обучение ИИ клиники",
        lead: "Настройте, как ИИ представляет клинику, какие знания использует и как отвечает пользовательам.",
        policyLayerTitle: "Правила ИИ для всей клиники (максимально допустимые)",
        policyLayerBody: "Определите, что ИИ может делать в клинике — категории, ограничения безопасности, языки и эскалация. Это верхний предел; координаторы и врачи выбирают активный режим для каждого пользовательа в Центре координации или в приложении врача.",
        liveControlNote: "Режим «Выкл / Помощь / Активен» для каждого пользовательа здесь не настраивается — используйте живую ИИ-координацию в каждом обращении.",
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
        openJourneys: "Открыть рабочие процессы лечения",
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
          conversionCoordinator: {
            title: "Координатор конверсии",
            hint: "Поведение с упором на доверие — тон, CTA, цены и запрещённые фразы (не бот продаж).",
          },
          materials: { title: "Бренды имплантов и материалы", hint: "Бренды, лаборатории, гарантия." },
          travel: { title: "Путешествие и проживание", hint: "Партнёрские отели для dental tourism." },
          logistics: { title: "Логистика клиники", hint: "Часы работы, SLA, экстренный контакт." },
          payment: { title: "Оплата и финансовая политика", hint: "Депозиты, рассрочка, возвраты." },
          workflow: { title: "Знания о workflow лечения", hint: "Визиты, заживление — операционно, не диагноз." },
          aiSafety: { title: "Безопасность ИИ и проверка человеком", hint: "Автономия по категориям." },
          handoff: { title: "Правила передачи человеку", hint: "Когда ИИ эскалирует координатору или врачу." },
          internalNotes: { title: "Внутренние заметки для ИИ", hint: "Позиционирование клиники." }
        },
        conversion: {
          introTitle: "ИИ-координатор лечения",
          introBody: "управление поведением (не бот продаж). Conversion Engine включён по умолчанию.",
          engineEnabled: "Conversion Engine включён",
          recordTimelineEvents: "Записывать события конверсии в timeline",
          safetyHeading: "Категории запрещённых фраз",
          presets: {
            soft_conversion_coordinator: "Мягкий координатор конверсии (по умолчанию)",
            luxury_clinic: "Люксовая клиника",
            budget_clinic: "Бюджетная клиника",
            dental_tourism: "Стоматологический туризм",
            implant_focused: "Фокус на имплантах",
            cosmetic_dentistry: "Эстетическая стоматология",
            international_patients: "Международные пользователи",
            consultation_focused: "Фокус на консультации",
          },
          intensity: {
            gentle: "Мягкий — информационный, доверие прежде всего",
            balanced: "Сбалансированный — активный координатор",
            proactive: "Проактивный — фокус на конверсии (без навязчивости)",
          },
          ctaStyle: {
            soft: "Мягкий — необязательное продолжение",
            balanced: "Сбалансированный — визиты и подготовка",
            proactive: "Проактивный — чёткий следующий шаг",
          },
          pricingBehavior: {
            educate_then_range: "Сначала объяснить, затем диапазон",
            range_only: "Только краткий диапазон",
            defer_to_coordinator: "Передать координатору",
          },
          nextStep: {
            collect_xray: "Запросить рентген / снимки",
            book_consultation: "Записать на консультацию",
            start_whatsapp: "Начать диалог в WhatsApp",
            schedule_visit: "Запланировать визит в клинику",
            collect_user_info: "Собрать данные пользовательа",
            explain_treatment_process: "Объяснить процесс лечения",
          },
        },
        sedationAvailable: "Седация доступна",
        weekendAvailability: "Работа в выходные",
        sameDayTreatment: "Лечение в тот же день",
        airportTransfer: "Трансфер из аэропорта",
        depositRequired: "Требуется депозит",
        installments: "Рассрочка",
        financing: "Финансирование",
        creditCard: "Банковская карта",
        autonomyIntro: "Выберите, насколько независимо ИИ может отвечать. Медицинские темы всегда требуют человека.",
        autonomyCategory: "Категория",
        autonomyLevel: "Уровень",
        safetyIntro: "Всегда требуется проверка человеком:",
        handoffIntro: "При отметке ИИ прекращает автоответ и предупреждает команду.",
        workflowJourneysHint: "Обучите ИИ типичному ходу лечения в вашей клинике — визиты, восстановление и контроль.",
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
          angryUser: "Злой пользователь",
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
        langs: { en: "Английский", tr: "Турецкий", ru: "Русский", ka: "Грузинский", ar: "Арабский", de: "Немецкий", fr: "Французский" },
        ui: {
          usedByAi: "Используется в ответах ИИ",
          usedByAiTitle: "Это поле питает слой оркестрации ИИ",
          usedByAiSection: "ИИ использует",
          seeExample: "Смотреть пример",
          aiPrefix: "ИИ:"
        },
        visibility: {
          patient_visible: { short: "Видно пациенту", label: "Может появиться в сообщениях пациенту" },
          ai_reply: { short: "Ответы ИИ", label: "Используется в ответах ИИ" },
          internal: { short: "Внутреннее", label: "Только внутреннее / операционное" }
        },
        options: {
          toneStyle: {
            warm_professional: "Тёплый + профессиональный",
            clinical_concise: "Клинический и краткий",
            friendly_casual: "Дружелюбный и неформальный",
            luxury_premium: "Люкс / премиум"
          },
          signatureStyle: {
            name_only: "Только имя ассистента",
            name_clinic: "Имя + клиника",
            none: "Без подписи"
          }
        },
        sectionHelp: {
          aiProfile: {
            intro: "Многоязычная оркестрация ИИ — включите языки и добавьте необязательные локализованные тексты для пользовательов. Операционные знания (бренды, цены, workflow) остаются в одном источнике; ИИ локализует при ответе.",
            aiUsageSummary: "Маршрутизация языка, локализованные приветствия/подписи и руководство по локализации для координатора."
          },
          conversionCoordinator: {
            intro: "Мягкая конверсия с упором на доверие — тон, CTA, цены и запрещённые фразы. Не бот продаж; Conversion Engine направляет ответы координатора.",
            aiUsageSummary: "Блок стратегии в чатах координатора; опциональная аналитика timeline.",
          },
          materials: {
            intro: "Какие бренды и материалы использует ваша клиника. ИИ объясняет варианты без выдуманных брендов.",
            aiUsageSummary: "Образовательные ответы об имплантах, цирконии, лабораториях и гарантии."
          },
          travel: {
            intro: "Партнёрские отели питают ИИ-координатора медицинского туризма — до 3 активных объектов на разговор (без векторной БД).",
            aiUsageSummary: "Координация медтуризма, рекомендации отелей и вопросы трансфера."
          },
          logistics: {
            intro: "Часы работы, время ответа и практические операции клиники.",
            aiUsageSummary: "Запись, доступность, экстренная маршрутизация и SLA fallback."
          },
          payment: {
            intro: "Депозит, финансирование, возвраты. ИИ объясняет политику — не обещает исключений.",
            aiUsageSummary: "Вопросы об оплате и политике; возвраты передаются человеку."
          },
          workflow: {
            intro: "Сроки визитов, заживление и координация после лечения. Только операционно — не диагноз.",
            aiUsageSummary: "Процесс лечения, восстановление, follow-up и post-op вопросы."
          },
          aiSafety: {
            intro: "Насколько независимо может действовать ИИ. Медицинские темы всегда требуют человека.",
            aiUsageSummary: "Оркестрация: автоответ, только предложение или выкл. по теме."
          },
          handoff: {
            intro: "Когда ИИ должен остановиться и предупредить координатора или врача.",
            aiUsageSummary: "Автоматические триггеры эскалации в разговоре."
          },
          internalNotes: {
            intro: "Позиционирование и стратегия клиники. ИИ согласуется с брендом — не показывается пользовательу дословно.",
            aiUsageSummary: "Контекст промпта для тона, приоритетов и акцентов."
          }
        },
        autonomyLevels: {
          OFF: "Выкл.",
          SUGGEST_ONLY: "Только предложение",
          AUTO_REPLY: "Автоответ",
          FULLY_AUTONOMOUS: "Полная автономия"
        },
        fieldHelp: {
          supportedLanguages: {
            label: "Многоязычная поддержка ИИ",
            helper: "Включите языки для оркестрации ИИ. Операционные данные в одном месте — ИИ локализует бренды, цены и логистику при ответе.",
            aiUsage: "Определение языка пользовательа, язык ответа и подсказки маршрутизации персонала.",
            example: "Основной английский; для dental tourism турецкий, русский, грузинский."
          },
          displayNameLocalized: {
            label: "Имя ассистента (локализовано)",
            helper: "Необязательные отображаемые имена по языкам. Пусто — ИИ переведёт с английского.",
            aiUsage: "Приветствия и подписи на языке пользовательа.",
            example: "en: DentX Care Team · ru: DentX Поддержка пользовательов"
          },
          welcomeMessageLocalized: {
            label: "Приветственное сообщение (локализовано)",
            helper: "Необязательные шаблоны открытия по языкам — для MVP не обязательно.",
            aiUsage: "Тон первого контакта и представление клиники.",
            placeholder: "Краткое приветствие на каждом включённом языке"
          },
          toneStyle: {
            label: "Тон / стиль",
            helper: "Общий стиль общения с пользовательами.",
            aiUsage: "Задаёт теплоту, формальность и уровень люкса в ответах.",
            example: "Тёплый + профессиональный для международного dental tourism."
          },
          signatureStyle: {
            label: "Стиль подписи",
            helper: "Как подписываются сообщения в конце.",
            aiUsage: "Добавляется к сообщениям ИИ для пользовательа."
          },
          profileTags: {
            label: "Теги профиля",
            helper: "Короткие теги атмосферы клиники (люкс, быстрый ответ и т.д.).",
            aiUsage: "Внутренние подсказки тона — не показываются пользовательу напрямую.",
            placeholder: "люкс, дружелюбный, премиум, быстрый_ответ",
            example: "премиум, дружелюбный, быстрый_ответ"
          },
          preset: {
            label: "Пресет клиники",
            helper: "Готовый стиль конверсии для типа клиники — тон, CTA и цены.",
            aiUsage: "Загружает правила пресета в блок стратегии Conversion Engine.",
          },
          coordinatorIntensity: {
            label: "Интенсивность координатора",
            helper: "Насколько активно ИИ ведёт к следующим шагам, сохраняя доверие.",
            aiUsage: "Поза конверсии: мягкая, сбалансированная или проактивная.",
          },
          ctaStyle: {
            label: "Стиль призыва к действию",
            helper: "Насколько прямо предлагать следующие шаги (рентген, консультация, WhatsApp, визит).",
            aiUsage: "Формирует завершения ответов и приглашения к follow-up.",
          },
          pricingBehavior: {
            label: "Поведение по ценам",
            helper: "Сначала объяснение и диапазон, только диапазон или передача координатору.",
            aiUsage: "Управляет ответами о стоимости.",
          },
          nextStepPreference: {
            label: "Предпочтительные следующие шаги",
            helper: "Какие шаги приоритизировать, когда уместно (не все сразу).",
            aiUsage: "Направляет выбор CTA в чатах координатора.",
          },
          forbidden_guarantees: {
            label: "Запрещённые гарантии",
            helper: "Фразы, которые ИИ никогда не должен использовать (по одной на строку).",
            aiUsage: "Фильтр безопасности для гарантий и результатов.",
            placeholder: "гарантированный результат\n100% успех",
          },
          forbidden_diagnosis: {
            label: "Запрещённый диагностический язык",
            helper: "Диагностические или категоричные формулировки для блокировки.",
            aiUsage: "Ответы остаются операционными, не клинический диагноз.",
          },
          forbidden_claims: {
            label: "Запрещённые маркетинговые заявления",
            helper: "Преувеличения и сравнения, которых следует избегать.",
            aiUsage: "Безопасные для бренда сообщения пользовательам.",
          },
          forbidden_urgency: {
            label: "Запрещённое давление срочности",
            helper: "Агрессивные формулировки срочности для блокировки.",
            aiUsage: "Предотвращает навязчивую или пугающую конверсию.",
          },
          implantBrands: { label: "Бренды имплантов", helper: "Бренды, которые вы обычно используете.", aiUsage: "Объяснение брендов и вариантов.", placeholder: "Straumann, Nobel, Osstem" },
          premiumBrands: { label: "Премиум бренды", helper: "Бренды высшего сегмента, если предлагаете.", aiUsage: "Сравнение премиум-вариантов." },
          zirconiumTypes: { label: "Типы циркония", helper: "Материалы для коронок/виниров.", aiUsage: "Вопросы о материалах.", placeholder: "E.max, многослойный цирконий" },
          labPartners: { label: "Партнёрские лаборатории", helper: "Своя или партнёрская лаборатория.", aiUsage: "Объяснение процессов." },
          warrantyInformation: { label: "Политика гарантии", helper: "Кратко условия гарантии.", aiUsage: "Вопросы о гарантии.", placeholder: "10 лет на имплант при ежегодном осмотре" },
          sedationAvailability: { label: "Седация доступна", helper: "Предлагается ли седация тревожным пациентам.", aiUsage: "Вопросы о комфорте и тревоге." },
          weekdayHours: { label: "Часы в будни", helper: "Когда клиника обычно открыта для записи и ответов.", aiUsage: "Запись и «когда вы открыты?»", placeholder: "09:00 – 18:00" },
          timezone: { label: "Часовой пояс клиники", helper: "IANA для записи и SLA.", aiUsage: "Конвертация времени для иностранных пациентов.", placeholder: "Europe/Istanbul" },
          averageResponseSlaMinutes: { label: "SLA ответа (минуты)", helper: "Целевое время ответа персонала. Для fallback ИИ — не показывается пациенту.", aiUsage: "SLA и эскалация.", placeholder: "120" },
          emergencyContact: { label: "Экстренный контакт", helper: "Телефон или инструкция. ИИ не даёт медсовет.", aiUsage: "Срочные случаи / сильная боль.", placeholder: "+90 … / WhatsApp срочная линия" },
          transportationNotes: { label: "Транспорт", helper: "Встреча в аэропорту, VIP трансфер.", aiUsage: "Координация приезда.", example: "Бесплатная встреча Пн–Сб для пациентов на лечении." },
          refundPolicy: { label: "Политика возврата", helper: "Стандартные правила. ИИ резюмирует — споры человеку.", aiUsage: "Вопросы о возврате.", placeholder: "Депозит возвращается при отмене за 14+ дней" },
          cancellationPolicy: { label: "Политика отмены", helper: "Условия отмены записи или пакета.", aiUsage: "Вопросы об отмене." },
          positioningNotes: { label: "Пункты позиционирования", helper: "Как позиционировать клинику. Один пункт на строку.", aiUsage: "Формирует акценты ИИ.", example: "Фокус на естественной эстетике\nБольшинство иностранных пациентов 5–7 дней" },
          freeformNotes: { label: "Доп. внутренние заметки", helper: "Что ещё должен знать персонал.", aiUsage: "Доп. контекст оркестрации." },
          protocol_postOpNotes: {
            label: "Post-op заметки координации",
            helper: "Как клиника обычно сопровождает пользовательов после лечения.",
            aiUsage: "Post-op ответы — не замена совета врача.",
            placeholder: "После имплантации 48 ч избегать твёрдой пищи.",
            example: "Мягкая диета 48 ч, лёд в первый день, контроль перед вылетом."
          }
        }
      },

      travel: {
        pageTitle: "Путешествие и проживание — Clinifly Admin",
        breadcrumbSettings: "Настройки клиники",
        breadcrumbCurrent: "Путешествие и проживание",
        title: "Путешествие и проживание",
        lead: "Партнёрские отели питают ИИ-координатора медтуризма — до 3 активных объектов на разговор (без векторной БД).",
        partnerHotels: "Партнёрские отели",
        addHotel: "+ Добавить отель",
        editHotel: "Редактировать отель",
        emptyList: "Партнёрских отелей пока нет. Добавьте первый объект для рекомендаций ИИ.",
        loading: "Загрузка…",
        futureNote: "Скоро: трансферы, водители, переводчики, апартаменты — архитектура готова, пока не включено.",
        saveHotel: "Сохранить отель",
        cancel: "Отмена",
        delete: "Удалить",
        edit: "Изменить",
        deleteConfirm: "Удалить этот отель?",
        openMaps: "Открыть карту",
        minFromClinic: "мин от клиники",
        chipPreferred: "Приоритетный",
        chipActive: "Активный",
        chipInactive: "Неактивный",
        chipTransfer: "Трансфер",
        chipBreakfast: "Завтрак",
        fieldName: "Название *",
        fieldPrice: "Диапазон цен (прибл.)",
        fieldDistance: "Расстояние (минуты от клиники)",
        fieldSort: "Порядок сортировки",
        fieldAddress: "Адрес",
        fieldMaps: "URL Google Maps",
        fieldBooking: "URL бронирования (необяз.)",
        fieldLangs: "Поддерживаемые языки",
        fieldDiscount: "Заметки о скидке клиники",
        fieldNotes: "Внутренние заметки",
        checkTransfer: "Трансфер включён / можно организовать",
        checkBreakfast: "Завтрак включён",
        checkPreferred: "Приоритетный партнёр",
        checkActive: "Активен (виден ИИ)",
        phName: "Radisson Blu Тбилиси",
        phPrice: "120–180 USD / ночь",
        phDistance: "8",
        phAddress: "Rose Revolution Square…",
        phMaps: "https://maps.google.com/…",
        phLangs: "en, ru, tr",
        phDiscount: "10% партнёрская скидка клиники",
        phNotes: "Только для координатора",
        errLoad: "Ошибка загрузки",
        errDelete: "Ошибка удаления",
        errSave: "Ошибка сохранения"
      },

      treatment: {
        patientName: "Имя пользовательа (выбор)",
        selectPatient: "— Выберите пользовательа —",
        patientHelp: "Автоматически подставляется при открытии из списка пользовательов. Смена пользовательа перезагружает данные.",
        noPatientSelected: "Пользователь не выбран.",
        loadingTreatments: "Загрузка планов лечения...",
        noTreatments: "План лечения для этого пользовательа не найден.",
        addTreatment: "Добавить лечение",
        saveTreatment: "Сохранить лечение",
        treatmentSaved: "✅ Лечение сохранено!",
        treatmentDeleted: "✅ Лечение удалено!",
        confirmDelete: "Удалить это лечение?",
        pageTitle: "Лечение - Clinifly Admin",
        upperJaw: "Верхняя челюсть",
        lowerJaw: "Нижняя челюсть",
        fdiUpper: "FDI 11–18 / 21–28",
        fdiLower: "FDI 31–38 / 41–48",
        selectedTooth: "Выбранный зуб:",
        selToothHint: "Нажмите на зуб, чтобы добавить процедуру.",
        clearSelection: "Сбросить выбор",
        procedureType: "Тип процедуры",
        loadingProcedures: "Загрузка...",
        statusLabel: "Статус",
        dateLabel: "Дата",
        timeLabel: "Время",
        datePolicy: "Политика даты",
        datePolicyManual: "MANUAL (создать напоминание)",
        datePolicyAuto: "AUTO (дата автоматически)",
        priceOptional: "Цена (опц.)",
        currencyLabel: "Валюта",
        quantityLabel: "Кол-во",
        chairNo: "Кресло №",
        doctorLabel: "Врач",
        doctorSelectOptional: "-- Врач (опц.) --",
        addProcedure: "+ Добавить процедуру",
        diagnosesOnTooth: "Диагнозы по этому зубу",
        addDiagnosisBtn: "+ Добавить диагноз",
        newDiagnosisTitle: "Новый диагноз",
        icdCodeLabel: "Код МКБ-10",
        descriptionLabel: "Описание",
        toothNoLabel: "Зуб №",
        toothPlaceholderAuto: "авто",
        notesOptionalLabel: "Заметка (опц.)",
        notesPlaceholder: "Необязательная заметка...",
        proceduresOnTooth: "Процедуры на этом зубе",
        treatmentEventsTitle: "🦷 События лечения (календарь)",
        treatmentEventsHelp: "События хранятся в таблице treatment_events.",
        eventTitlePlaceholder: "Имплант, день 1",
        eventDescPlaceholder: "КТ + установка импланта",
        teTypeTreatment: "Лечение",
        teTypeConsult: "Консультация",
        teTypeFollowup: "Контроль",
        teTypeLab: "Лаборатория / снимок",
        addEvent: "➕ Добавить событие",
        eventListTitle: "Список событий",
        thDateTime: "Дата/время",
        thType: "Тип",
        thTitle: "Заголовок",
        patientToothDiagnoses: "Диагнозы по зубам пользовательа",
        badgeToothDoctor: "Зуб № + диагноз врача",
        noDiagnosisSummary: "Записей диагнозов нет.",
        emptyStateTitle: "Записей лечения пока нет",
        emptyStateSub: "Данные появятся после загрузки.",
        selectPatientAbove: "Выберите пользовательа выше.",
        loadingTreatmentsMsg: "Загрузка лечения...",
        loadFailed: "Не удалось загрузить: {error}",
        noRecordsYet: "Записей нет. Выберите зуб и добавьте процедуру.",
        loadedSummary: "{teethCount} зубов, процедур: {procCount}.",
        headerTitle: "Лечение",
        loadError: "Ошибка загрузки: {error}",
        selectToothFirst: "⚠️ Сначала выберите зуб",
        toothLocked: "Зуб удалён (заблокирован). Новые процедуры недоступны.",
        selectProcedureType: "Выберите тип процедуры.",
        invalidDateTime: "Неверный формат даты/времени.",
        diagCodeOrDesc: "Введите код или описание МКБ-10.",
        saveFailedWithMsg: "Не сохранено: {error}",
        deleteFailedWithMsg: "Не удалено: {error}",
        errorWithMsg: "Ошибка: {error}",
        saveAllSuccess: "Все процедуры сохранены ✅",
        saveAllError: "Ошибка сохранения: {error}",
        deleteBtn: "Удалить",
        eventsEmpty: "Нет событий.",
        procLineTooth: "Зуб {tooth} • ",
        selToothHintLocked: "⛔ Зуб удалён (locked). Новые процедуры недоступны. Только история.",
        pickToothFromChart: "Нажмите на зуб на схеме выше, чтобы выбрать его.",
        noProcOnTooth: "На этом зубе пока нет процедур.",
        noDiagOnTooth: "Нет записей диагноза по этому зубу.",
        noDescription: "Нет описания",
        diagGroupTooth: "🦷 Зуб {tooth}",
        diagGroupGeneral: "🦷 Общие диагнозы",
        diagNotAdded: "Диагнозы не добавлены",
        toothDiagCountTitle: "На этом зубе {count} записей диагноза",
        datePrefix: "Дата:",
        chairLabel: "Кресло",
        editInlineTitle: "Редактировать в строке",
        statusSelectTitle: "Выберите статус",
        statusCycleTitle: "Нажмите для смены статуса (PLANNED → ACTIVE → COMPLETED → CANCELLED → PLANNED)",
        inlineProcTypePh: "Тип процедуры",
        inlineUnitPricePh: "Цена за ед.",
        inlineQtyPh: "Кол-во",
        inlineChairPh: "Кресло №",
        inlineDoctorPick: "-- Выберите врача --",
        deleteTitle: "Удалить",
        selToothHintActive: "Нажмите на зуб, чтобы добавить процедуру.",
        status: {
          PLANNED: "Запланировано",
          ACTIVE: "В процессе",
          COMPLETED: "Завершено",
          CANCELLED: "Отменено"
        }
      },
      timeline: {
        tooth: "Зуб",
        procedure: "Процедура",
        status: "Статус"
      },
      date: {
        monthsShort: ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
        weekdays: ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]
      },
      files: {
        pageTitle: "Admin – Файлы пользовательа",
        title: "📁 Файлы пользовательа",
        selectPatient: "Пользователь:",
        selectPlaceholder: "Выберите пользовательа...",
        filterAll: "Все",
        filterPhoto: "📸 Фото",
        filterXray: "🦷 Рентген",
        filterPdf: "📄 PDF",
        filterChat: "💬 Чат",
        upload: "Загрузить",
        empty: "Файлы не найдены.",
        selectToView: "Выберите пользовательа для просмотра файлов.",
        badgeImage: "Фото",
        badgeXray: "Рентген",
        badgePdf: "PDF",
        badgeFile: "Файл",
        badgeChat: "Чат",
        download: "Скачать"
      },
      doctorListV2: {
        pageTitle: "👨‍⚕️ Врачи",
        documentTitle: "Врачи - Clinifly Admin",
        statPending: "Ожидают",
        statApproved: "Одобрено",
        statRejected: "Отклонено",
        statTotal: "Всего",
        searchPlaceholder: "Поиск по имени, email или телефону...",
        filterAll: "Все статусы",
        filterOptionPending: "Ожидают",
        filterOptionApproved: "Одобрено",
        filterOptionActive: "Активен",
        filterOptionRejected: "Отклонено",
        refresh: "↺ Обновить",
        loading: "Загрузка...",
        empty: "Записей врачей пока нет.",
        errorHttp: "HTTP {status}",
        errorLoad: "Не удалось загрузить",
        sectionProfessional: "Профессия",
        labelExperience: "Опыт",
        labelUniversity: "Университет",
        labelGraduation: "Окончание",
        labelProfile: "Профиль",
        labelBio: "О себе",
        profilePublic: "🌐 Открыт",
        profilePrivate: "🔒 Скрыт",
        sectionSpecialty: "Специализация",
        sectionLanguages: "Языки",
        sectionProcedures: "Процедуры",
        notSpecified: "Не указано",
        yearsCount: "{years} лет",
        dash: "—",
        status: {
          PENDING: "Ожидает",
          APPROVED: "Одобрено",
          ACTIVE: "Активен",
          REJECTED: "Отклонён"
        },
        btnApprove: "✅ Одобрить",
        btnReject: "❌ Отклонить",
        confirmApprove: "Одобрить этого врача?",
        confirmReject: "Отклонить эту заявку?",
        approvedAlert: "✅ Врач одобрен!",
        rejectedAlert: "Заявка отклонена.",
        errorGeneric: "Ошибка"
      },
      chat: {
        documentTitle: "Чат - Clinifly Admin",
        pageHeading: "💬 Clinifly Admin – Чат",
        title: "Сообщения",
        patientsHeading: "Пользователи",
        loading: "Загрузка...",
        selectPatient: "Выберите пользовательа",
        noPatients: "Пользовательов пока нет",
        unnamed: "Без имени",
        placeholder: "Введите сообщение...",
        send: "Отправить",
        sending: "Отправка...",
        noMessages: "Сообщений пока нет",
        newMessage: "Новое сообщение",
        youJoined: "Вы вошли в чат",
        photo: "Фото",
        file: "Файл",
        photoFile: "📷 Фото",
        fileAttach: "📎 Файл",
        download: "Скачать",
        uploadHelp: "Допустимо: JPG, PNG, HEIC (до 10 МБ) • PDF/DOC/DOCX/TXT/XLS/XLSX (до 20 МБ) • ZIP (до 50 МБ)",
        sentOk: "✓ Отправлено",
        uploadError: "✗ Ошибка",
        errNoToken: "❌ Нет токена администратора. Войдите.",
        errTokenList: "Нужен токен администратора",
        errAuth: "❌ Ошибка авторизации. Войдите снова.",
        errAuthShort: "❌ Ошибка авторизации",
        errUnknown: "Неизвестная ошибка",
        errLoadList: "❌ Не удалось загрузить пользовательов: {message}",
        errLoadMessages: "Сообщения не загружены",
        errLoadMessagesFull: "❌ Сообщения не загружены: {message}",
        errSelectFirst: "❌ Сначала выберите пользовательа",
        errNoTokenSend: "❌ Нет токена администратора",
        errSend: "Не удалось отправить сообщение",
        errSendFull: "❌ Не удалось отправить: {message}",
        errFileUpload: "❌ Не удалось загрузить файл: {message}",
        errSession: "❌ Сессия истекла. Обновите и войдите снова.",
        errForbidden: "❌ Тип файла не разрешён: {ext}. RAR и исполняемые файлы запрещены.",
        errMime: "❌ Тип файла не определён. Попробуйте другой.",
        errImageFmt: "❌ Разрешено: JPG, PNG, HEIC – до 10 МБ",
        errDocFmt: "❌ Разрешено: PDF, DOC/DOCX, TXT, XLS/XLSX, ZIP",
        errPhotoSize: "❌ Фото меньше 10 МБ",
        errZipSize: "❌ ZIP меньше 50 МБ",
        errDocSize: "❌ Документ меньше 20 МБ",
        errSelectPatient: "❌ Сначала выберите пользовательа",
        before: "До",
        after: "После",
        doctorReview: "👨‍⚕️ Проверка врача",
        defaultClinic: "Клиника",
        defaultPhoto: "Фото",
        defaultFile: "Файл",
        navClinicSettings: "Настройки клиники"
      },
      leads: {
        documentTitle: "Лиды — Clinifly Admin",
        pageTitle: "Входящие лидов",
        subtitle:
          "Один ответственный врач на поток; команда клиники по-прежнему видит переписку в разделе сообщений.",
        backDashboard: "← Панель",
        refreshList: "Обновить список",
        statusLoading: "Загрузка…",
        statusUnassigned: "{count} записей",
        thPatient: "Пользователь",
        thContact: "Контакт",
        thPreview: "Последнее сообщение",
        thAssign: "Назначить врача",
        thPrimary: "Ответственный врач",
        thLastActivity: "Активность",
        thStatus: "Статус",
        thActions: "Действия",
        empty: "Нет лидов.",
        selectDoctor: "Выберите врача…",
        assign: "Назначить",
        reassign: "Переназначить",
        unassign: "Снять назначение",
        openChat: "Открыть чат",
        badgeUnassigned: "Не назначен",
        badgePrimarySet: "Назначен ответственный",
        primaryNone: "—",
        confirmUnassign: "Снять назначение ответственного врача?",
        successUnassigned: "Назначение снято.",
        errChooseDoctor: "Сначала выберите врача.",
        successAssigned: "Назначено.",
        errLoad: "Ошибка загрузки",
        showAssignedToggle: "Показать назначенные",
        assignedBadgePrefix: "Dr.",
        assignedOk: "Назначено:",
        assignDisabledHint: "Лид уже назначен.",
        autoAssignAll: "Назначить всех без ответственного",
        autoAssignSelected: "Назначить выбранных",
        autoAssignRunning: "Автоназначение…",
        autoAssignDone: "Назначено: {assigned}, пропущено: {skipped}, ошибок: {failed}.",
        autoAssignDistributionPrefix: "Распределение:",
        autoAssignPartialFail: "Часть назначений не выполнена:",
        autoAssignAllConfirm: "Назначить все неназначенные лиды этой клиники с равномерным распределением?",
        autoAssignNoneSelected: "Выберите хотя бы один неназначенный лид.",
        selectAllUnassignedTitle: "Выбрать все неназначенные строки на странице",
        leadRoutingSectionTitle: "Маршрутизация новых лидов",
        leadRoutingHelp:
          "Только для новых потоков лидов. Не меняет существующие потоки и ручное назначение.",
        leadRoutingEnable: "Автоназначение ответственного для новых лидов",
        leadRoutingMode: "Режим",
        leadRoutingModeManual: "Только вручную — без назначения",
        leadRoutingModeFixed: "Фиксированный врач",
        leadRoutingModeRoundRobin: "По кругу (доступные врачи)",
        leadRoutingModeBalanced: "Баланс (меньше всего назначенных лидов)",
        leadRoutingFixedDoctor: "Фиксированный врач",
        leadRoutingSave: "Сохранить настройки",
        leadRoutingSaved: "Настройки сохранены.",
        leadRoutingLoadError: "Не удалось загрузить настройки.",
        leadRoutingTableMissing: "Нет таблицы clinic_lead_routing_settings — выполните миграцию.",
        tabNeedsAssignment: "Требуют назначения",
        tabRecentlyRouted: "Недавно направленные",
        tabAssigned: "Назначенные",
        thChannel: "Канал",
        thAssignedAt: "Назначено",
        searchPlaceholder: "Поиск пользовательа, телефона, сообщения…",
        channelMessenger: "Messenger",
        channelWhatsapp: "WhatsApp",
        channelWeb: "Web",
        channelUnknown: "Другое",
        emptyNeedsAssignment: "Нет лидов, ожидающих ручного назначения.",
        emptyRecentRouted: "Нет автоназначенных лидов за последние 24 часа.",
        emptyAssigned: "Нет назначенных лидов.",
        statusNeedsAssignment: "{count} лидов ждут назначения",
        statusRecentRouted: "{count} недавно направленных лидов",
        statusAssigned: "{count} назначенных лидов",
        badgeNewRouted: "Новое направление",
      }
    },

    ka: {
      common: {
        loading: "იტვირთება...", save: "შენახვა", cancel: "გაუქმება", delete: "წაშლა",
        edit: "რედაქტირება", search: "ძებნა", filter: "ფილტრი", close: "დახურვა",
        back: "უკან", next: "შემდეგ", previous: "წინა", submit: "გაგზავნა",
        yes: "დიახ", no: "არა", ok: "OK", error: "შეცდომა", success: "წარმატება", warning: "გაფრთხილება",
        doctor: "ექიმი"
      },
      adminPages: {
        travelH1: "✈️ Clinifly Admin — მოგზაურობა",
        travelGlobalWarning: "⚠️ ყურადღება: ნაწილი ველების შეავსებს მომხმარებელიი. შეამოწმეთ მინიშნებები ქვემოთ.",
        travelWordHotel: "სასტუმრო",
        travelWordFlights: "ფრენა",
        travelListSeparator: " და ",
        travelDynamicWarning: "⚠️ ყურადღება: {list} შეავსებს მომხმარებელიი. ამ ველების რედაქტირება არ შეგიძლიათ. მომხმარებელიი შეიყვანს მობილურ აპში.",
        healthH1: "🩺 Clinifly Admin — ჯანმრთელობა",
        doctorApplicationsH1: "ექიმის განაცხადები",
        doctorAppsStatPending: "მოლოდინში",
        doctorAppsStatApproved: "დამოწმებული",
        doctorAppsStatRejected: "უარყოფილი",
        doctorAppsStatTotal: "სულ",
        doctorAppsLoading: "ექიმების ჩატვირთვა...",
        doctorAppsEmptyTitle: "ექიმები ჯერ არ არის",
        doctorAppsEmptyDesc: "განაცხადი ჯერ არ შექმნილა.",
        activePatientsH1: "👨‍⚕️ აქტიური მომხმარებლები",
        activePatientsStatActive: "აქტიური",
        activePatientsStatPending: "მოლოდინში",
        activePatientsStatTotal: "მომხმარებლები სულ",
        activePatientsStatClinic: "კლინიკები",
        activePatientsSearchPlaceholder: "ძებნა სახელით, ელფოსტით ან ტელეფონით...",
        activePatientsAllClinics: "ყველა კლინიკა",
        activePatientsRefresh: "🔄 განახლება",
        activePatientsLoading: "🔄 იტვირთება...",
        activePatientsEmpty: "აქტიური მომხმარებელიი ჯერ არ არის",
        treatmentCreateH1: "🏥 მკურნალობის შექმნა",
        treatmentCreateSubtitle: "შექმენით ახალი ჯგუფი და მიანიჭეთ ექიმები",
        patientDetailH1: "მომხმარებლის დეტალები",
        patientDetailBack: "უკან",
        legacyNavClinics: "კლინიკები"
      },
      dashboard: {
        title: "Clinifly Admin – მართვის პანელი",
        sidebar: {
          mainMenu: "მთავარი მენიუ",
          management: "მართვა",
          logout: "გასვლა",
          clinic: "კლინიკა"
        },
        nav: { dashboard: "პანელი", patients: "პაციენტები", invitePatients: "პაციენტების მოწვევა", travel: "მოგზაურობა", treatment: "მკურნალება", schedule: "განრიგი", doctors: "ექიმები", chat: "ჩათი", leads: "ლიდების ინბოქსი", leadsNeedsAssignment: "მიბმა სჭირდება", leadsRecentlyRouted: "ახლახან გადამისამართებული", leadsAssigned: "დანიშნული", aiLeads: "კოორდინაციის ცენტრი", files: "ფაილები", referrals: "მოწვევები", marketplaceProfile: "კატალოგის პროფილი", helpCenter: "დახმარების ცენტრი", learningCandidates: "AI სწავლა", health: "ჯანმრთელობა", settings: "პარამეტრები", login: "შესვლა", register: "კლინიკის რეგისტრაცია" },
        charts: {
          metricTitleMonthlyPatients: "ყოველთვიული რეგისტრაციის რაოდენობა",
          metricTitleMonthlyProcedures: "ყოველთვიული პროცედურების რაოდენობა",
          chartLabelMonthlyRegistered: "ყოველთვიული რეგისტრაცია",
          activePatients: "აქტიური მომხმარებლები",
          procedures: "პროცედურები",
          noData: "მონაცემი არ არის",
          trendNote: "ტრენდი გაუმჯობესდება მეტი მონაცემის დაგროვებისას",
          vsPreviousMonth: "წინა თვესთან შედარებით",
          noPreviousData: "წინა მონაცემი არ არის",
          summaryActivePatients: "{count} აქტიური მომხმარებელიი • {month}",
          summaryMonthlyRegistered: "{count} რეგისტრაცია • {month}",
          summaryProcedures: "{count} პროცედურა • {month}"
        },
        upcoming: {
          title: "📅 კლინიკის განრიგი",
          subtitle: "ყველა მოვლენა (წარსული და მომავალი)",
          empty: "მომავალი მოვლენები არ არის",
          today: "დღეს",
          tomorrow: "ხვალ",
          dayAfterTomorrow: "ზეგ",
          daysLater: "{count} დღეში",
          weeksLater: "{count} კვირაში",
          overdue: "⚠️ ვადაგადაცილებული: {count}",
          overdueDesc: "გაქვთ {count} ვადაგადაცილებული მოვლენა.",
          status: { planned: "დაგეგმილია", done: "შესრულებულია" },
          summary: { overdue: "ვადაგადაცილებული:", today: "დღეს:", tomorrow: "ხვალ:", patients: "პაციენტი", events: "მოვლენა" },
          eventTypes: {
            TRAVEL_EVENT: "მოგზაურობის მოვლენა",
            FLIGHT: "რეისი",
            HOTEL: "სასტუმრო",
            AIRPORT_PICKUP: "აეროპორტის ტრანსფერი",
            TREATMENT: "მკურნალება",
            CONSULT: "კონსულტაცია",
            FOLLOWUP: "კონტროლი",
            LAB: "ლაბორატორია / სკანირება",
            HEALTH: "ჯანმრთელობის ფორმა",
            APPOINTMENT: "ჩაწერა",
            PAYMENT: "გადახდა",
            SURGERY: "ქირურგია",
            CHECKUP: "გასინჯვა"
          }
        },
        planUsage: "პლანი და გამოყენება",
        activeTreatments: "აქტიური მკურნალობები",
        monthlyUploads: "თვიური ატვირთვები",
        referralInvites: "რეფერალური მოწვევები",
        totalReferrers: "რეფერერების სულ",
        patientRoster: "მომხმარებლები (სიის ლიმიტი)",
        usagePeriodNote: "ყოველთვიური გამოყენების პერიოდი (UTC): {period}",
        usageFreshness: "მონაცემები აქტუალურია: {time}",
        upgrade: "გაუმჯობესება",
        unlimited: "შეუზღვავი",
        planAlertCrit: "ლიმიტი ამოიწურა. გასაგრძელებლად აირჩიეთ უფრო მაღალი ტარიფი.",
        planAlertWarn: "ლიმიტს უახლოვდებით",
        planTierTitle: "მიმდინარე სააბონემენტო დონე",
        confirmOpenPricing: "გავხსნათ ფასების გვერდი?\n\n{url}",
        metricsErrorHint: "დეტალებისთვის ნახეთ ბრაუზერის კონსოლი (F12)"
      },
      calendar: {
        documentTitle: "კალენდარი - Clinifly Admin",
        pageTitle: "ჩაწერის კალენდარი",
        title: "ჩაწერის კალენდარი",
        weekRangeTitle: "კვირის დიაპაზონი",
        today: "დღეს",
        week: "კვირა",
        month: "თვე",
        prev: "← წინ",
        previous: "← წინ",
        next: "შემდეგ →",
        timeColumn: "საათი",
        doctor: "ექიმი",
        chair: "სკამი",
        allDoctors: "ყველა ექიმი",
        allChairs: "ყველა სკამი",
        noEvents: "მოვლენები არ არის",
        noAppointmentsForWeek: "არჩეული კვირისთვის ჩაწერა ვერ მოიძებნა.",
        noAppointmentsForRange: "არჩეული პერიოდისთვის ჩაწერა ვერ მოიძებნა.",
        summaryLine: "{count} ჩაწერა • {doctorCount} ექიმი • {chairCount} სკამი",
        loading: "იტვირთება...",
        tokenMissing: "ადმინის ტოკენი ვერ მოიძებნა. ხელახლა შედით.",
        sessionExpired: "სესია ამოიწურა. გადამისამართება...",
        fetchFailed: "ჩაწერის ჩატვირთვა ვერ მოხერხდა: {message}",
        doctorNotFound: "ექიმი ვერ მოიძებნა",
        chairWithNumber: "სკამი {n}"
      },
      pricing: {
        title: "Clinifly ტარიფები",
        subtitle: "მოქნილი გეგმები აქტიური მომხმარებლების რაოდენობაზე",
        info: "გადაიხადეთ მხოლოდ აქტიური მომხმარებლების რაოდენობის მიხედვით.",
        periodMonthly: "/თვე",
        free: {
          name: "Free",
          patients: "5 მომხმარებელიი",
          description: "სცადეთ Clinifly რეალურ მომხმარებელიებთან.",
          cta: "დაწყება"
        },
        basic: {
          name: "Pro",
          badge: "პოპულარული",
          patients: "15 მომხმარებელიი",
          description: "ძლიერი პაკეტი მზარდი კლინიკებისთვის.",
          cta: "გეგმის გაუმჯობესება"
        },
        pro: {
          name: "Premium",
          patients: "ულიმიტო მომხმარებელიი",
          description: "პრემიუმ მხარდაჭერა მსხვილი კლინიკებისთვის.",
          cta: "გეგმის გაუმჯობესება",
          contactCta: "დაგვიკავშირდით"
        },
        features: {
          allCore: "ყველა ძირითადი ფუნქცია",
          patientCommunication: "მომხმარებელითან კომუნიკაცია",
          fileSharing: "ფაილების გაზიარება",
          referral: "რეფერალის სისტემა",
          branding: "Clinifly ბრენდინგი",
          customBranding: "მორგებული ბრენდინგი",
          analytics: "ანალიტიკა",
          support: "ელფოსტის მხარდაჭერა",
          unlimitedPatients: "ულიმიტო მომხმარებლები",
          advancedReferral: "გაფართოებული რეფერალი (დონეები, კამპანიები)",
          prioritySupport: "პრიორიტეტული მხარდაჭერა",
          onboarding: "ონბორდინგ მხარდაჭერა"
        },
        comparison: {
          feature: "ფუნქცია",
          free: "Free",
          basic: "Pro",
          pro: "Premium",
          patients: "აქტიური მომხმარებლები",
          unlimited: "ულიმიტო",
          coreFeatures: "ძირითადი ფუნქციები",
          branding: "Clinifly ბრენდინგი",
          customBranding: "მორგებული ბრენდინგი",
          referral: "რეფერალის სისტემა",
          advancedReferral: "გაფართოებული რეფერალი",
          analytics: "ანალიტიკა",
          support: "მხარდაჭერა",
          community: "საზოგადოება",
          email: "ელფოსტა",
          priority: "პრიორიტეტული"
        },
        faq: {
          title: "ხშირად დასმული კითხვები",
          q1: {
            question: "როგორ ითვლება აქტიური მომხმარებლების რაოდენობა?",
            answer: "ითვლება მხოლოდ APPROVED (აქტიური) მომხმარებლები. Pending, rejected ან cancelled არ შედის ლიმიტში."
          },
          q2: {
            question: "რა ხდება ლიმიტის ამოწურვისას?",
            answer: "არსებულ მომხმარებელიებთან მუშაობას გააგრძელებთ. იზღუდება მხოლოდ ახალი მომხმარებლების დამტკიცება."
          },
          q3: {
            question: "შემიძლია გეგმის შეცვლა?",
            answer: "დიახ, შეგიძლიათ ნებისმიერ დროს განაახლოთ ან შეცვალოთ გეგმა."
          },
          q4: {
            question: "გადახდის რა მეთოდებია ხელმისაწვდომი?",
            answer: "ვიღებთ საბანკო ბარათებს, საბანკო გადარიცხვებს და ლოკალურ გადახდის მეთოდებს."
          }
        },
        contact: {
          title: "გაქვთ განსაკუთრებული საჭიროებები?",
          description: "მსხვილი კლინიკებისთვის ხელმისაწვდომია ინდივიდუალური გეგმები.",
          button: "დაგვიკავშირდით"
        }
      },
      login: {
        title: "Clinifly Admin-ში შესვლა",
        subtitle: "შედით არსებული კლინიკის ანგარიშით",
        clinicCode: "კლინიკის კოდი",
        clinicCodeRequired: "*",
        clinicCodePlaceholder: "SAAT",
        clinicCodeHelp: "შეიყვანეთ თქვენი კლინიკის კოდი",
        password: "პაროლი",
        passwordRequired: "*",
        passwordHelp: "შეიყვანეთ პაროლი",
        submit: "შესვლა",
        submitLoading: "იტვირთება...",
        registerLink: "კლინიკის რეგისტრაცია",
        dashboardLink: "პანელზე გადასვლა",
        forgotPasswordLink: "დაგავიწყდათ პაროლი?",
        forgotTitle: "პაროლის აღდგენა",
        forgotSubtitle: "თქვენს რეგისტრირებულ ელ-ფოსტაზე გამოგზავნება 6-ნიშნა დადასტურების კოდი.",
        forgotSend: "დადასტურების კოდის გაგზავნა",
        forgotResend: "კოდის ხელახლა გაგზავნა",
        forgotResendWait: "ხელახლა გაგზავნა",
        forgotOtpTitle: "ელ-ფოსტის დადასტურება",
        forgotOtpSubtitle: "შეიყვანეთ ელ-ფოსტაში მიღებული 6-ნიშნა კოდი.",
        forgotOtpCode: "დადასტურების კოდი",
        forgotVerifyOtp: "კოდის დადასტურება",
        forgotSetPasswordTitle: "ახალი პაროლი",
        forgotSetPasswordSubtitle: "დადასტურება დასრულდა — დააყენეთ ახალი პაროლი.",
        forgotNewPassword: "ახალი პაროლი",
        forgotConfirmPassword: "ახალი პაროლი (გამეორება)",
        forgotReset: "პაროლის შენახვა",
        forgotBack: "შესვლაზე დაბრუნება",
        forgotSuccess: "პაროლი განახლდა. შეგიძლიათ შეხვიდეთ.",
        forgotOtpSent: "დადასტურების კოდი გამოგზავნილია თქვენს ელ-ფოსტაზე.",
        forgotPasswordMismatch: "პაროლები არ ემთხვევა.",
        forgotPasswordTooShort: "პაროლი უნდა იყოს მინიმუმ 6 სიმბოლო.",
        forgotInvalidIdentity: "კლინიკის კოდი ან ელ-ფოსტა არ ემთხვევა.",
        forgotResetFailed: "პაროლის განახლება ვერ მოხერხდა. სცადეთ ხელახლა.",
        forgotOtpInvalid: "კოდი არასწორია ან ვადა გაუვიდა.",
        forgotOtpRequired: "ჯერ დაასრულეთ ელ-ფოსტის დადასტურება.",
        forgotRateLimit: "გთხოვთ, 1 წუთი დაელოდოთ და ხელახლა სცადოთ.",
        success: "მოგესალმებით, {name}! შესვლა წარმატებულია.",
        loginSuccess: "შესვლა წარმატებულია",
        sessionExpired: "⏰ სეანსი ამოიწურა ან ტოკენი არასწორია. გთხოვთ, ხელახლა შეხვიდეთ.",
        otpTitle: "OTP დადასტურება",
        otpSubtitle: "შეიყვანეთ ელ-ფოსტაზე გამოგზავნილი დადასტურების კოდი",
        otpEmailHelp: "შეიყვანეთ ელ-ფოსტა, სადაც OTP მიიღეთ",
        otpCode: "დადასტურების კოდი",
        otpCodeRequired: "*",
        otpHelp: "შეიყვანეთ ელ-ფოსტაში მიღებული 6-ნიშნა კოდი",
        verifyOTP: "OTP-ის დადასტურება",
        verifying: "მოწმდება",
        backToLogin: "შესვლაზე დაბრუნება",
        errors: {
          clinicCodeRequired: "გთხოვთ, შეიყვანოთ კლინიკის კოდი.",
          passwordRequired: "გთხოვთ, შეიყვანოთ პაროლი.",
          emailRequired: "გთხოვთ, შეიყვანოთ ელ-ფოსტა.",
          invalidCredentials: "კლინიკის კოდი ან პაროლი არასწორია.",
          loginFailed: "შესვლა ვერ მოხერხდა. სცადეთ ხელახლა.",
          loginFailedDetail: "შესვლა ვერ მოხერხდა: {detail}",
          serverError: "სერვერის შეცდომა",
          apiNotJson: "API-მ JSON არ დააბრუნა. შეამოწმეთ API მისამართი: {api}",
          genericError: "შესვლის შეცდომა: {error}",
          otpRequired: "გთხოვთ, შეიყვანოთ დადასტურების კოდი.",
          otpInvalid: "დადასტურების კოდი არასწორია. შეიყვანეთ 6-ნიშნა კოდი.",
          otpFailed: "დადასტურება ვერ მოხერხდა. სცადეთ ხელახლა.",
          otpNotFound: "დადასტურების კოდი ვერ მოიძებნა. მოითხოვეთ ახალი კოდი.",
          otpExpired: "დადასტურების კოდის ვადა გაუვიდა. მოითხოვეთ ახალი კოდი."
        }
      },
      auth: { email: "ელ-ფოსტა", password: "პაროლი", confirm_password: "დაადასტურეთ პაროლი", name: "სახელი და გვარი" },
      register: {
        title: "შექმენით თქვენი კლინიკა",
        subtitle: "დაიწყეთ რამდენიმე წუთში — ეს უფასოა.",
        clinicCode: "კლინიკის კოდი",
        clinicCodeRequired: "*",
        clinicCodeWhat: "რა არის კლინიკის კოდი?",
        clinicCodeHelp: "კლინიკის კოდი — თქვენი კლინიკის მოკლე, უნიკალური სიმბოლოა, როგორც აბრევიატურა ან ნიშანი. რეგისტრაციისას თქვენ ირჩევთ; მომხმარებლები აპლიკაციაში ამ კოდს შეიყვანენ თქვენთან დასაკავშირებლად.",
        clinicCodeTip1: "3–12 სიმბოლო; მხოლოდ დიდი ასოები და ციფრები (მაგ. CEM, ELKO, MOON)",
        clinicCodeTip2: "აირჩიეთ კლინიკის სახელიდან ან ისეთი სიმბოლო, რომელიც ადვილად დაგიმახსოვრდებათ",
        clinicCodeTip3: "ეს არ არის თქვენი პაროლი — შეგიძლიათ მომხმარებელიებთან გაუზიაროთ",
        clinicCodePlaceholder: "მაგ. CEM, ELKO, MOON",
        clinicCodeHint: "მაგალითები: CEM, ELKO, SMILE",
        invitationCode: "მოწვევის კოდი",
        invitationCodeOptional: "(არასავალდებულო)",
        invitationCodeHelp: "თუ გაქვთ კამპანიის კოდი, შეიყვანეთ premium საცდელი პერიოდის გასააქტიურებლად.",
        name: "კლინიკის სახელი",
        nameRequired: "*",
        namePlaceholder: "ჩემი კლინიკა",
        nameHelp: "თქვენი კლინიკის სახელი",
        email: "ელ-ფოსტა",
        emailRequired: "*",
        emailPlaceholder: "clinic@example.com",
        emailHelp: "თქვენი კლინიკის ელფოსტა",
        password: "პაროლი",
        passwordRequired: "*",
        passwordHelp: "მინიმუმ 6 სიმბოლო",
        confirmPassword: "პაროლის დადასტურება",
        confirmPasswordRequired: "*",
        confirmPasswordHelp: "უნდა ემთხვეოდეს პაროლს",
        phone: "ტელეფონი",
        phonePlaceholder: "+995 555 123 456",
        address: "მისამართი",
        addressPlaceholder: "თბილისი, საქართველო",
        submit: "კლინიკის რეგისტრაცია",
        submitLoading: "იტვირთება...",
        loginLink: "უკვე გაქვთ ანგარიში? შესვლა",
        dashboardLink: "პანელზე გადასვლა",
        errors: {
          clinicCodeRequired: "გთხოვთ, შეიყვანოთ კლინიკის კოდი.",
          nameRequired: "გთხოვთ, შეიყვანოთ კლინიკის სახელი.",
          emailRequired: "გთხოვთ, შეიყვანოთ ელფოსტა.",
          emailInvalid: "გთხოვთ, შეიყვანოთ სწორი ელფოსტა.",
          emailExists: "ეს ელფოსტა უკვე გამოყენებულია.",
          clinicCodeExists: "ეს კლინიკის კოდი უკვე გამოყენებულია.",
          passwordRequired: "გთხოვთ, შეიყვანოთ პაროლი.",
          passwordMinLength: "პაროლი უნდა იყოს მინიმუმ 6 სიმბოლო.",
          passwordMismatch: "პაროლები არ ემთხვევა.",
          registerFailed: "რეგისტრაცია ვერ მოხერხდა. სცადეთ ხელახლა.",
          genericError: "რეგისტრაციის შეცდომა: {error}",
          termsNotAccepted: "გთხოვთ, მიიღოთ მომსახურების ხელშეკრულება.",
          timeout: "მოთხოვნის დრო ამოიწურა (60 წმ.). შეამოწმეთ API მისამართი და ინტერნეტი."
        },
        success: "კლინიკა წარმატებით დარეგისტრირდა! გადამისამართება შესვლის გვერდზე...",
        successTitle: "რეგისტრაცია წარმატებულია!",
        successMessage: "კლინიკა წარმატებით დარეგისტრირდა. ადმინის ტოკენი შენახულია ბრაუზერში.",
        clinicInformation: "კლინიკის ინფორმაცია",
        adminToken: "ადმინის ტოკენი",
        copyToken: "📋 ტოკენის კოპირება",
        goToPatients: "მომხმარებლების სიაზე",
        goToDashboard: "პანელზე გადასვლა",
        termsText: "წავიკითხე, გავიგე და ვეთანხმები Clinifly ციფრული პლატფორმის მომსახურების ხელშეკრულებას. ვაცნობიერებ, რომ უფასო პაკეტის ფარგლებში მომსახურება უფასოა, უფასო პაკეტის გარეთ — ფასიანი, და მომსახურების მოცულობა და ღირებულება ცალკე განისაზღვრება.",
        connectingRetry: "⏳ უკავშირდება… ხელახლა {seconds} წმ-ში",
        otp: {
          title: "ელ-ფოსტის დადასტურება",
          intro: "დადასტურების კოდი გამოგზავნილია {email} მისამართზე. კლინიკის რეგისტრაციის დასასრულებლად შეიყვანეთ კოდი ქვემოთ.",
          codeLabel: "დადასტურების კოდი",
          codeHelp: "შეიყვანეთ ელ-ფოსტაში მიღებული 6-ნიშნა კოდი",
          verify: "დადასტურება და რეგისტრაციის დასრულება",
          verifying: "მოწმდება...",
          resend: "კოდის ხელახლა გაგზავნა",
          sending: "იგზავნება...",
          back: "რეგისტრაციაზე დაბრუნება",
          invalidCode: "გთხოვთ, შეიყვანოთ სწორი 6-ნიშნა დადასტურების კოდი",
          resent: "ახალი დადასტურების კოდი გამოგზავნილია თქვენს ელ-ფოსტაზე",
          clinicCodeExists: "კლინიკის კოდი {code} უკვე არსებობს. გადამისამართება შესვლის გვერდზე...",
          emailExists: "ელ-ფოსტა {email} უკვე რეგისტრირებულია. გადამისამართება შესვლის გვერდზე..."
        }
      },
      patients: {
        title: "👥 Clinifly Admin – მომხმარებლები",
        search: "მომხმარებლის ძებნა...",
        filter: "ფილტრი",
        registeredPatients: "რეგისტრირებული მომხმარებლები",
        searchPlaceholder: "ძებნა: სახელი / ტელეფონი / patientId / clinicCode",
        filterAll: "ყველა",
        clearFilters: "გასუფთავება",
        refresh: "განახლება",
        loading: "იტვირთება...",
        noResults: "შედეგი არ არის",
        selectedPatient: "არჩეული მომხმარებელიი: {name}",
        patientId: "User ID: {id}",
        copyId: "ID-ის კოპირება",
        copyIdSuccess: "✅ Kullanıcı ID დაკოპირდა",
        clear: "გასუფთავება",
        travel: "მოგზაურობა",
        treatment: "მკურნალება",
        health: "ჯანმრთელობა",
        chat: "ჩათი",
        files: "📁 ფაილები",
        approve: "დადასტურება",
        approveConfirm: "გსურთ პაციენტის დადასტურება? ({patientId})",
        approveSuccess: "✅ მომხმარებელიი დადასტურებულია",
        addPatient: "➕ მომხმარებლის დამატება",
        addPatientTitle: "ახალი მომხმარებელიი",
        firstName: "სახელი *",
        lastName: "გვარი *",
        email: "ელფოსტა",
        dateOfBirth: "დაბადების თარიღი",
        address: "მისამართი",
        notes: "შენიშვნები",
        cancel: "გაუქმება",
        add: "დამატება",
        addSuccess: "✅ მომხმარებელიი წარმატებით დაემატა",
        addError: "❌ მომხმარებლის დამატება ვერ მოხერხდა",
        assignDoctorLabel: "ექიმის მინიჭება:",
        assignButton: "მინიჭება",
        selectDoctorPlaceholder: "აირჩიეთ ექიმი",
        noDoctorAssigned: "ექიმი მინიჭებული არ არის",
        before: "ადრე",
        after: "შემდეგ",
        phone: "ტელეფონი",
        status: { PENDING: "მოლოდინში", APPROVED: "დადასტურებულია" },
        errors: {
          noToken: "⚠️ ადმინის ტოკენი ვერ მოიძებნა. ჯერ შედით სისტემაში.",
          unauthorized: "❌ ავტორიზაციის შეცდომა. ხელახლა შედით.",
          loadFailed: "❌ მომხმარებლების სიის ჩატვირთვა ვერ მოხერხდა: {error}",
          approveFailed: "❌ დადასტურების შეცდომა: {error}",
          patientLimitReached: "⚠️ აქტიური მომხმარებლების ლიმიტი ამოიწურა. ახლის დასამატებლად განაახლეთ გეგმა.",
          patientLimitReachedTitle: "მომხმარებლების ლიმიტი"
        },
        limits: {
          title: "აქტიური მომხმარებლების ლიმიტი",
          message: "თქვენს გეგმაში {current}/{limit} აქტიური მომხმარებელიია.",
          upgradeMessage: "ახალი მომხმარებლების დასამატებლად განაახლეთ გეგმა.",
          upgradeButton: "გეგმის განახლება",
          continueButton: "არსებული მომხმარებლებით გაგრძელება"
        }
      },
      referrals: {
        title: "🎁 Clinifly Admin – მოწვევები",
        referrals: "მოწვევები",
        filterAll: "ყველა",
        refresh: "↻ განახლება",
        loading: "იტვირთება...",
        noReferrals: "მოწვევები ვერ მოიძებნა.",
        inviter: "მოწვეული",
        invited: "მოპატიჟებული",
        createdAt: "შეიქმნა",
        inviterDiscount: "მოწვეულის ფასდაკლება",
        invitedDiscount: "მოპატიჟებულის ფასდაკლება",
        discount: "ფასდაკლება",
        approve: "დადასტურება",
        reject: "უარყოფა",
        approveConfirm: "დარწმუნებული ხართ?",
        rejectConfirm: "დარწმუნებული ხართ?",
        approved: "მოწვევა დადასტურებულია ✅",
        rejected: "მოწვევა უარყოფილია ✅",
        found: "ნაპოვნია {count} მოწვევა.",
        activityPageTitle: "🎁 მოწვევების აქტივობა",
        statTotalReferrers: "მოწვეულთა სულ",
        statInvitedUtcMonth: "მოწვეული ამ UTC თვეში",
        statInvitedUtcMonthTitle: "იგივე რაც გეგმა და გამოყენება → მოწვევები (ბილინგი / SaaS)",
        statTotalInvitedAllTime: "მოწვეულთა სულ (ყველა დროის)",
        statRegistered: "რეგისტრირებული",
        statTreated: "მკურნალობა გავლილი",
        statPending: "დასადასტურებელი",
        pendingSectionTitle: "ადმინის დადასტურებას მოლოდინი",
        thStatus: "სტატუსი",
        thCode: "კოდი",
        thDate: "თარიღი",
        thActions: "მოქმედება",
        summaryTitle: "მოწვეულთა შეჯამება",
        filterAllStatuses: "ყველა სტატუსი",
        filterRegisteredOpt: "რეგისტრირებული",
        filterTreatedOpt: "მკურნალობა",
        filterRewardedOpt: "დაჯილდოებული",
        thReferrer: "მოწვეული",
        thInvitedCount: "მოწვეული",
        thRegisteredCount: "რეგისტრ.",
        thTreatedCount: "მკურნალობა",
        thInvitedPatients: "მოწვეული მომხმარებლები",
        loadingMain: "იტვირთება…",
        sessionExpired: "სესია ამოიწურა. ხელახლა შედით.",
        errorLoad: "შეცდომა: {message}",
        emptyPending: "დასადასტურებელი არ არის.",
        emptyActivity: "მოწვევის აქტივობა ვერ მოიძებნა.",
        statusBadgePending: "დადასტურებას ელოდება",
        statusShortInvited: "მოწვეული",
        statusShortRegistered: "რეგისტრირებული",
        statusShortTreated: "მკურნალობა",
        statusShortRewarded: "დაჯილდოებული",
        registrationRate: "{percent}% რეგისტრაციის მაჩვენებელი",
        morePatients: "კიდევ +{count}",
        unknownReferrer: "უცნობი",
        requestFailed: "მოთხოვნა ვერ შესრულდა",
        discountErrorHint: "კლინიკის პარამეტრებში მიუთითეთ რეფერალის ფასდაკლების პროცენტები.",
        defaultDiscounts: "ნაგულისხმევი ფასდაკლება: მოწვეული %{inviter}%, მოპატიჟებული %{invited}%",
        defaultDiscountsRequired: "⚠️ ნაგულისხმევი პროცენტები უნდა იყოს კლინიკის პარამეტრებში.",
        status: { PENDING: "მოლოდინში", APPROVED: "დადასტურებულია", REJECTED: "უარყოფილია" },
        errors: {
          noToken: "⚠️ ტოკენი ვერ მოიძებნა.",
          loadFailed: "ჩატვირთვის შეცდომა.",
          approveFailed: "შეცდომა: {error}",
          rejectFailed: "შეცდომა: {error}",
        },
      },
      marketplaceProfile: {
        title: "Clinifly Admin – კატალოგის პროფილი",
        pageTitle: "საჯარო კატალოგის პროფილი",
        subtitle: "მართეთ, როგორ ჩანს თქვენი კლინიკა Clinifly-ის მომხმარებელითა კატალოგში. რეპუტაციის მონაცემებს კლინიკა ივსებს — Google და Trustpilot ხელით. დადასტურებული, გამორჩეული და სპონსორის ბეჯებს Clinifly ანიჭებს.",
        loading: "პროფილი იტვირთება…",
        loadFailed: "ჩატვირთვა ვერ მოხერხდა",
        saving: "ინახება…",
        saved: "პროფილი შენახულია.",
        saveFailed: "შენახვა ვერ მოხერხდა",
        saveBtn: "პროფილის შენახვა",
        reloadBtn: "განახლება",
        sectionCompletion: "პროფილის შევსება",
        sectionCompletionHint: "სრული პროფილები ეხმარება მომხმარებელიებს შედარებასა და ნდობაში.",
        completed: "შევსებული",
        missing: "აკლია",
        nothingYet: "ჯერ არაფერი",
        allDone: "ყველაფერი მზადაა",
        publishTitle: "საჯარო კატალოგში გამოქვეყნება",
        publishHint: "საჭიროა: ლოგო, აღწერა, ქვეყანა, ≥1 სპეციალობა, ≥1 ენა, ვებსაიტი ან სოციალური ბმული",
        sectionBadges: "პლატფორმის ბეჯები",
        sectionBadgesHint: "მხოლოდ Clinifly — ცვლილებისთვის დაუკავშირდით Clinifly-ს.",
        sectionReputation: "რეპუტაცია და ნდობა",
        sectionReputationHint: "კლინიკის მიერ — დააკოპირეთ Google Business, Facebook Page და Trustpilot გვერდებიდან.",
        sectionGoogleReviews: "Google მიმოხილვები",
        sectionFacebookReviews: "Facebook მიმოხილვები",
        sectionTrustpilotReviews: "Trustpilot მიმოხილვები",
        facebookReviewsHelp: "გახსენით Facebook გვერდი და დააკოპირეთ URL. შეიყვანეთ რეკომენდაციის პროცენტი და რაოდენობა.",
        reputationPreviewLabel: "მომხმარებლისთვის გამოსაჩენი პრევიუ",
        reputationPreviewEmpty: "შეიყვანეთ ქულები ზემოთ, რომ ნახოთ პრევიუ.",
        sectionSocial: "სოციალური და ვებ",
        sectionClinicInfo: "კლინიკის ინფორმაცია",
        sectionMedia: "მედია",
        sectionMediaHint: "ჩასვით საჯარო სურათის/ვიდეო URL-ები (გალერეაში თითო ხაზზე ერთი).",
        locationHint: "იგივე ლოკაცია, რაც პარამეტრებში → კლინიკის ძებნის ფილტრებისთვის.",
        listedButMissing: "გამოქვეყნებულია, მაგრამ აკლია: {items}",
        toPublishComplete: "გამოსაქვეყნებლად შეავსეთ: {items}",
        fields: {
          googleBusinessUrl: "Google Business URL",
          googleRating: "Google რეიტინგი (0–5)",
          googleReviewCount: "Google მიმოხილვების რაოდენობა",
          facebookPageUrl: "Facebook გვერდის URL",
          facebookRecommendationScore: "Facebook რეკომენდაციის ქულა",
          facebookRecommendationCount: "Facebook მიმოხილვა / რეკომენდაციის რაოდენობა",
          trustpilotUrl: "Trustpilot URL",
          trustpilotRating: "Trustpilot რეიტინგი (0–5)",
          trustpilotReviewCount: "Trustpilot მიმოხილვების რაოდენობა",
          yearsInOperation: "საქმიანობის წლები",
          intlPatients: "საერთაშორისო მომხმარებლები / წელი",
          website: "ვებსაიტი",
          facebook: "Facebook",
          instagram: "Instagram",
          tiktok: "TikTok",
          youtube: "YouTube",
          linkedin: "LinkedIn",
          googleMaps: "Google Maps URL",
          shortDescription: "მოკლე აღწერა",
          aboutText: "შესახებ (სურვილისამებრ გრძელი ტექსტი)",
          country: "ქვეყანა",
          city: "ქალაქი",
          languages: "ენები (მძიმით გამოყოფილი, მაგ. English, Turkish, Russian)",
          specialties: "სპეციალობები (მძიმით გამოყოფილი, მაგ. Implantology, Aesthetic Dentistry)",
          logoUrl: "ლოგოს URL",
          coverPhotoUrl: "საფარის ფოტოს URL",
          galleryPhotos: "გალერეის სურათები (ერთი URL ხაზზე)",
          beforeAfter: "ადრე / შემდეგ სურათები (ერთი URL ხაზზე)",
          videoUrls: "ვიდეო URL-ები (ერთი ხაზზე)",
        },
        placeholders: {
          googleBusinessUrl: "https://g.page/…",
          facebookPageUrl: "https://www.facebook.com/yourclinic",
          facebookRecommendationScore: "96",
          facebookRecommendationCount: "145",
          trustpilotUrl: "https://www.trustpilot.com/review/…",
          shortDescription: "ერთი ხაზი საძიებო ბარათებისთვის",
          aboutText: "გაფართოებული „შესახებ“ პროფილის გვერდზე",
          city: "თბილისი, ანტალია, სტამბოლი…",
          galleryPhotos: "https://…",
          beforeAfter: "https://…",
          videoUrls: "https://youtube.com/…",
        },
        checklist: {
          logo: "ლოგო",
          description: "აღწერა",
          website: "ვებსაიტი",
          googleRating: "Google რეიტინგი",
          languages: "ენები",
          specialties: "სპეციალობები",
          clinicPhotos: "კლინიკის ფოტოები",
          video: "ვიდეო",
          doctorProfiles: "ექიმის პროფილები",
          coverPhoto: "საფარის ფოტო",
          country: "ქვეყანა",
          city: "ქალაქი",
          specialty: "მინიმუმ 1 სპეციალობა",
          language: "მინიმუმ 1 ენა",
          websiteOrSocial: "ვებსაიტი ან სოციალური ბმული",
        },
        badges: {
          verified: "დადასტურებული",
          featured: "გამორჩეული",
          placement: "განთავსება",
          featuredUntil: "გამორჩეული ვადა",
          yes: "კი",
          no: "არა",
        },
        tiers: {
          standard: "სტანდარტული",
          featured: "გამორჩეული",
          sponsored: "სპონსორული",
        },
        countries: {
          "": "აირჩიეთ ქვეყანა",
          GE: "საქართველო",
          TR: "თურქეთი",
          GB: "გაერთიანებული სამეფო",
          DE: "გერმანია",
          US: "აშშ",
          AE: "არაბთა გაერთიანებული საამიროები",
          AZ: "აზერბაიჯანი",
          AM: "სომხეთი",
          RU: "რუსეთი",
          UA: "უკრაინა",
          FR: "საფრანგეთი",
          IT: "იტალია",
          ES: "ესპანეთი",
          NL: "ნიდერლანდები",
          SA: "საუდის არაბეთი",
          IL: "ისრაელი",
        },
      },
      helpCenter: {
        pageTitle: "Clinifly-ით დაწყება",
        subtitle: "ნაბიჯ-ნაბიჯ სახელმძღვანელოები კლინიკის მორგების, პროფილის, ექიმების, მომხმარებლებისა და AI-ისთვის. ტექნიკური ჟარგონის გარეშე.",
        searchPlaceholder: "დახმარების ძებნა…",
        searchNoResults: "მასალა ვერ მოიძებნა. სცადეთ სხვა სიტყვები ან გადახედეთ განყოფილებებს.",
        checklistTitle: "სწრაფი მორგების სია",
        checklistHint: "ამ თანმიმდევრობით დაიწყეთ მომხმარებლების მიღება.",
        topicsTitle: "თემები",
        showAll: "ყველა თემის ჩვენება",
        supportText: "კიდევ გჭირდებათ დახმარება?",
        videoLink: "სასწავლო ვიდეოები",
        whatLabel: "რა არის?",
        whyLabel: "რატომ გამოვიყენო?",
        howLabel: "როგორ დავაყენო?",
        tipsLabel: "რჩევები",
        openPage: "გვერდის გახსნა",
        screenshotCaption: "მაგალითის ეკრანი — თქვენი პანელი შეიძლება განსხვავდებოდეს.",
        dashboardBannerTitle: "Clinifly-ით დაწყება",
        dashboardBannerDesc: "სახელმძღვანელოები პროფილის, ექიმების, მომხმარებლებისა და AI-ისთვის — კლინიკის მფლობელებისთვის.",
        dashboardBannerBtn: "დახმარების ცენტრი →",
        settingsBanner: "გჭირდებათ დახმარება მორგებაში, AI-ში ან რეფერალებში? გახსენით დახმარების ცენტრი.",
        openLink: "დახმარების ცენტრი →",
        profileGuideLink: "📖 საჯარო პროფილის შევსება — ნაბიჯ-ნაბიჯ",
        googleGuideLink: "Google მიმოხილვების გზამკვლევი",
        checklist: {
          register: "კლინიკის რეგისტრაცია",
          settings: "კლინიკის ინფო (პარამეტრები)",
          aiTraining: "AI სასწავლო ცენტრი",
          prices: "ფასების სია",
          directory: "კატალოგის პროფილი",
          doctors: "ექიმის დადასტურება",
          leadInbox: "ლიდის მიბმა",
          whatsapp: "WhatsApp დაკავშირება",
          invitePatients: "მომხმარებლის მოწვევის ბმული",
        },
        sections: {
          "create-clinic": { title: "შექმენით კლინიკა", subtitle: "რეგისტრაცია, დადასტურება და განახლება" },
          "connect-doctors": { title: "დააკავშირეთ ექიმები", subtitle: "მოწვევა, შეერთება, დადასტურება" },
          "add-patients": { title: "დაამატეთ პაციენტები", subtitle: "შეერთება, დადასტურება, მოწვევა" },
          "public-profile": { title: "საჯარო პროფილი", subtitle: "ლოგო, აღწერა, ფოტოები, სპეციალობები" },
          "google-reviews": { title: "Google მიმოხილვები", subtitle: "Google Business Clinifly-ში" },
          "social-media": { title: "სოციალური ბმულები", subtitle: "ვებსაიტი, Instagram, Facebook" },
          "ai-assistant": { title: "AI ასისტენტი", subtitle: "AI, WhatsApp და Messenger" },
          "international-patients": { title: "საერთაშორისო პაციენტები", subtitle: "აღმოჩენა, ენები, მოთხოვნები" },
          "referral-system": { title: "რეფერალური სისტემა", subtitle: "მოწვევები და სარგებელი" },
          faq: { title: "ხშირი კითხვები", subtitle: "სწრაფი პასუხები" },
        },
      },
      settings: {
        title: "⚙️ კლინიკის პარამეტრები",
        pageTitle: "⚙️ Clinifly Admin – პარამეტრები",
        clinicInformation: "კლინიკის ინფორმაცია",
        brandingNotice: "ბრენდინგის პარამეტრები ხელმისაწვდომია მხოლოდ PRO გეგმისთვის.",
        subscriptionPlan: "სააბონემენტო გეგმა",
        subscriptionPlanHelp: "შეგიძლიათ შეცვალოთ FREE / BASIC / PRO პაკეტი.",
        usageLoading: "იტვირთება…",
        usageActiveTreatments: "აქტიური მკურნალობები",
        usageMonthlyUploads: "თვიური ატვირთვები (UTC თვე)",
        usageReferrals: "რეფერალური მოწვევები (ეს UTC თვე)",
        usagePatients: "რეგისტრირებული მომხმარებლები (ლიმიტი)",
        usagePeriodNote: "გამოყენების პერიოდი (UTC თვე): {period}",
        usageLoadFailed: "გამოყენების მონაცემების ჩატვირთვა ვერ მოხერხდა.",
        usageFreshness: "ინფორმაციის დრო: {time}",
        currentPlan: "მიმდინარე გეგმა: {plan}",
        planUpgrade: "გეგმის განახლება",
        planChangesNote: "გეგმის შეცვლა ხდება ფასების გვერდიდან.",
        locationTitle: "მდებარეობა",
        locationAllPlans: "ყველა გეგმა",
        countryLabel: "ქვეში",
        cityLabel: "ქალაქი",
        cityPlaceholder: "Antalya, Istanbul, London, Tbilisi...",
        locationDiscoveryHelp: "მომხმარებელიებს შეუძლიათ კლინიკების ფილტრაცია ქვეყნით და ქალაქით.",
        selectCountry: "აირჩიეთ ქვეში",
        countryRequiredAlert: "აირჩიეთ ქვეში.",
        cityRequiredAlert: "ქალაქი სავალდებულოა.",
        plan: "გეგმა",
        branding: "ბრენდინგი",
        clinicName: "კლინიკის სახელი",
        clinicLogoUrl: "კლინიკის ლოგოს URL",
        clinicLogoUrlHelp: "ლოგო ნაჩვენებია Pro გეგმისთვის",
        chairCountLabel: "სკამების რაოდენობა",
        chairCountHelp: "კალენდარში საჩვენებელი სკამების რაოდენობა (მაგ.: 1, 2, 3).",
        address: "კლინიკის მისამართი",
        addressHelp: "ნაჩვენებია მომხმარებლის ეკრანზე Pro გეგმისთვის",
        googleMapLink: "Google Maps ბმული",
        googleMapLinkHelp: "ნაჩვენებია მომხმარებლის ეკრანზე Pro გეგმისთვის",
        primaryColor: "ძირითადი ფერი (Hex)",
        secondaryColor: "მეორადი ფერი (Hex)",
        welcomeMessage: "მისასალმებელი შეტყობინება",
        referralDiscounts: "🎁 მოწვევის ფასდაკლებები",
        referralDiscountsHelp: "დააყენეთ ფასდაკლების პროცენტები წარმატებული მოწვევებისთვის.",
        referralDiscount: "მოწვევის ფასდაკლება (%)",
        referralDiscountHelp: "ფასდაკლება მიეწოდება ორივეს: მოწვეულსა და მოპატიჟებულს",
        aiCommunication: {
          title: "AI კომუნიკაცია",
          desc: "დააყენეთ პირველი პასუხის სიჩქარე Messenger-ში, Instagram-ში და WhatsApp-ში. <strong>მყისიერი</strong> რეჟიმი მომხმარებელიებს წამებში ხვდება. <strong>ადამიანის მოლოდინი</strong> რეჟიმში AI ჩაერთვება, თუ გუნდი ქვემოთ მითითებულ დროში არ პასუხობს.",
          instant: "მყისიერი AI პასუხები (სწრაფ შეტყობინებების გაერთიანება Messenger/WhatsApp-ზე)",
          waitHuman: "ადამიანის მოლოდინი AI-მდე",
          humanOnly: "მხოლოდ ადამიანი (AI ავტომატური პასუხი არა)",
          timingHintInstant:
            "მყისიერი რეჟიმი: თუ პაციენტი რამდენიმე მოკლე შეტყობინებას გაგზავნის, AI ცოტა ხანს ელოდება და ერთ პასუხს აგზავნის. რეკომენდებული: 5 წამი.",
          timingHintWait:
            "ადამიანის მოლოდინი: თუ გუნდი ქვემოთ მითითებულ დროში არ პასუხობს, AI გააგზავნის პირველ შეტყობინებას. მყისიერი მისასალმებელი არ არის.",
          timingHintHumanOnly:
            "Messenger-სა და WhatsApp-ზე ავტომატური AI პასუხები გამორთულია — ყველა შეტყობინებას თქვენი გუნდი პასუხობს.",
          humanTakeoverLabel: "გუნდის დუმილი სანამ AI ჩაერთვება",
          secondsWord: "წმ",
          messageBufferLabel: "AI პასუხის დაყოვნება (სწრაფი შეტყობინებების გაერთიანება)",
          bufferInstant: "მყისიერი (გაერთიანება არა)",
          buffer3s: "3 წამი",
          buffer5s: "5 წამი (რეკომენდებული)",
          buffer10s: "10 წამი",
          messageBufferHelp:
            "თუ პაციენტი რამდენიმე მოკლე შეტყობინებას გაგზავნის, ბოლო შეტყობინების შემდეგ ეს ხანს ელოდება და ერთ AI პასუხს აგზავნის (Messenger / WhatsApp / Instagram).",
          omniDelayLabel: "მყისიერი პასუხის დაყოვნება (Messenger / WhatsApp)",
          omniDelayHelp:
            "გამოიყენეთ ზემოთ «AI პასუხის დაყოვნება». რეკომენდებულია 5 წამი სწრაფ შეტყობინებების ერთ პასუხად გაერთიანებისთვის.",
          fallbackHelp:
            "მხოლოდ «ადამიანის მოლოდინი» რეჟიმში: AI გააგზავნის პირველ შეტყობინებას, თუ გუნდი ამ ხანს დუმს.",
          bookingModeLabel: "AI კალენდრის ჯავშნის რეჟიმი",
          bookingDraft: "ჯავშნის დრაფტი (პერსონალის დადასტურება) — რეკომენდებული",
          bookingSuggest: "მხოლოდ შეთავაზება (კალენდარში ჩაწერა არა)",
          bookingAuto: "სრული ავტომატური ჯავშანა (დაუყოვნებლივ დადასტურებული)",
          bookingHint: "AI ამოწმებს კალენდრის რეალურ ხელმისაწვდომობას, ჯავშნამდე ითხოვს ტელეფონს/WhatsApp-ს და პატივს სცემს სამუშაო საათებს, ბუფერებსა და ლანჩის შესვენებას.",
          clinicHoursLabel: "კლინიკის სამუშაო დღეები (AI განრიგი)",
          clinicOpenLabel: "იხსნება",
          clinicCloseLabel: "იხურება",
          clinicTimezoneLabel: "კლინიკის დროის ზონა",
          clinicHoursHint: "AI მხოლოდ ამ საათებში სთავაზობს ჯავშნის სლოტებს (კლინიკის ადგილობრივი დრო). მაგალითი: გახსნა 08:00 — არა 07:00.",
          save: "AI კომუნიკაციის შენახვა",
          loading: "ჩატვირთვა…",
          signInRequired: "AI კომუნიკაციის კონფიგურაციისთვის შედით სისტემაში.",
          loadFailed: "AI კომუნიკაციის პარამეტრები ვერ ჩაიტვირთა.",
          saving: "შენახვა…",
          saveFailed: "შენახვა ვერ მოხერხდა: {error}",
          saved: "შენახულია. Messenger/WhatsApp ამ პასუხის დროებს გამოიყენებს.",
        },
        communicationChannels: {
          title: "კომუნიკაციის არხები",
          desc: "დაუკავშირდით გარე არხებს, რათა მომხმარებლის შეტყობინებები AI კოორდინატორის ფოსტაში გამოჩნდეს წყაროს ბეიჯებით (WhatsApp, Messenger, Instagram, Web).",
          whatsapp: "WhatsApp →",
          messenger: "Messenger →",
        },
        referralLevel1: "დონე 1 (%)",
        referralLevel1Help: "საერთო ფასდაკლება 1 წარმატებული მოწვევის შემდეგ",
        referralLevel2: "დონე 2 (%)",
        referralLevel2Help: "საერთო ფასდაკლება 2 წარმატებული მოწვევის შემდეგ",
        referralLevel3: "დონე 3 (%)",
        referralLevel3Help: "მაქსიმალური ფასდაკლება 3+ მოწვევისთვის",
        referralSettings: "🎯 მოწვევის პარამეტრები",
        referralSettingsHelp: "დააყენეთ მოწვევის სისტემის საპროცენტო განაკვეთები.",
        referralPerInvite: "მოწვევაზე შემოსავალი (%)",
        referralPerInvitePlaceholder: "10",
        referralPerInviteHelp: "ფასდაკლება თითოეული წარმატებული მოწვევისთვის",
        referralMaxTotal: "მაქსიმალური საერთო ფასდაკლება (%)",
        referralMaxTotalPlaceholder: "10",
        referralMaxTotalHelp: "მოწვეულის მიერ მიღებული მაქსიმალური ფასდაკლება.",
        temporaryPatientLimit: "🔧 დროებითი მომხმარებლის ლიმიტი",
        temporaryPatientLimitHelp: "დაამატეთ დროებითი ლიმიტი გაყიდვების პროცესისთვის.",
        temporaryLimit: "დროებითი ლიმიტი",
        temporaryLimitPlaceholder: "დამატებითი მომხმარებლები (მაგ.: 5)",
        saveTemporaryLimit: "დროებითი ლიმიტის შენახვა",
        removeTemporaryLimit: "დროებითი ლიმიტის წაშლა",
        temporaryLimitActive: "მიმდინარე დროებითი ლიმიტი: +{count} მომხმარებელიი",
        referralPreviewLabel: "💡 გადახედვა:",
        referralPreviewNone: "❌ ფასდაკლება არ გამოიყენება",
        referralPreviewLow: "✅ <strong>{discount}% ფასდაკლება</strong> გამოიყენება როგორც მოწვეულისთვის, ასევე მოპატიჟებულისთვის.<br><span style=\"color:#10b981\">💡 შესანიშნავი დასაწყისი ახალი მომხმარებლების მოსაზიდად!</span>",
        referralPreviewMid: "🎉 <strong>{discount}% ფასდაკლება</strong> ორივე მხარისთვის.<br><span style=\"color:#f59e0b\">⚠️ მეტი ფასდაკლება — უფრო მიმზიდველი მოწვევები!</span>",
        referralPreviewHigh: "🚀 <strong>{discount}% ფასდაკლება</strong> — მაქსიმალური დონე!<br><span style=\"color:#ef4444\">⚠️ ძალიან სულგრძელი — შეამოწმეთ მომგებიანობა!</span>",
        save: "💾 პარამეტრების შენახვა",
        saveLoading: "შენახვა...",
        treatmentPriceList: "💰 მკურნალობის ფასების სია",
        treatmentPriceListHelp: "დააყენეთ თქვენი კლინიკის მკურნალობის ფასები.",
        currency: "ვალუტა",
        loadingPrices: "ფასების ჩატვირთვა...",
        saveAllPrices: "💾 ყველა ფასის შენახვა",
        tableHeaders: {
          treatment: "პროცედურა",
          price: "ფასი",
          recommended: "რეკომენდებული",
          duration: "ხანგრძლივობა (წთ)",
          breakMin: "შესვენება (წთ)",
          active: "აქტიური",
          options: "პარამეტრები",
        },
        categoryLabels: {
          EVENTS: "შეხვედრები / დიაგნოსტიკა",
          PROSTHETIC: "პროთეტიკა",
          RESTORATIVE: "რესტავრაცია",
          ENDODONTIC: "ენდოდონტია",
          SURGICAL: "ქირურგია",
          IMPLANT: "იმპლანტაცია"
        },
        recommendedDuration: "~{minutes} წთ",
        minutes: "წთ",
        opsProfileCardTitle: "კლინიკის AI სწავლება",
        opsProfileCardDesc: "დააყენეთ, როგორ წარმოადგენს AI კლინიკას, რა ცოდნას იყენებს და როგორ პასუხობს მომხმარებელიებს.",
        opsProfileCardPricing: "ფასები და ბრენდის ვარიანტები — ქვემოთ <strong>ფასების სიაში</strong>.",
        opsProfileOpen: "AI სწავლების ცენტრი →",
      },

      opsProfile: {
        pageTitle: "კლინიკის AI სწავლება — Clinifly Admin",
        title: "კლინიკის AI სწავლება",
        lead: "დააყენეთ, როგორ წარმოადგენს AI კლინიკას, რა ცოდნას იყენებს და როგორ პასუხობს მომხმარებელიებს.",
        policyLayerTitle: "კლინიკის მასშტაბის AI წესები (დაშვებული ზღვარი)",
        policyLayerBody: "განსაზღვრეთ, რას შეუძლია AI თქვენს კლინიკაში — კატეგორიები, უსაფრთხოების ლიმიტები, ენები და ესკალაცია. ეს ზღვარია; კოორდინატორები და ექიმები თითოეული მომხმარებლისთვის აქტიურ რეჟიმს ირჩევენ კოორდინაციის ცენტრში ან ექიმის აპში.",
        liveControlNote: "მომხმარებელიზე გამორთული / დამხმარე / აქტიური აქ არ ირჩევა — გამოიყენეთ ცოცხალი AI კოორდინაცია თითოეულ მოთხოვნაში.",
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
        openJourneys: "მკურნალობის ნაკადების გახსნა",
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
          conversionCoordinator: {
            title: "კონვერსიის კოორდინატორი",
            hint: "ნდობაზე დაფუძნებული ქცევა — ტონი, CTA, ფასები და აკრძალული ფრაზები (არა გაყიდვების ბოტი).",
          },
          materials: { title: "იმპლანტის ბრენდები და მასალები", hint: "ბრენდები, ლაბორატორიები, გარანტია." },
          travel: { title: "მოგზაურობა და საცხოვრებელი", hint: "პარტნიორი სასტუმროები." },
          logistics: { title: "კლინიკის ლოჯისტიკა", hint: "საათები, SLA, გადაუდებელი კონტაქტი." },
          payment: { title: "გადახდა და ფინანსური პოლიტიკა", hint: "დეპოზიტი, განვადება, დაბრუნება." },
          workflow: { title: "მკურნალობის workflow ცოდნა", hint: "ვიზიტები, განკურნება." },
          aiSafety: { title: "AI უსაფრთხოება და ადამიანის შემოწმება", hint: "ავტონომია კატეგორიებით." },
          handoff: { title: "ადამიანზე გადაცემის წესები", hint: "როდის AI ესკალირებს." },
          internalNotes: { title: "შიდა AI შენიშვნები", hint: "კლინიკის პოზიციონირება." }
        },
        conversion: {
          introTitle: "AI მკურნალობის კოორდინატორი",
          introBody: "ქცევის მართვა (არა გაყიდვების ბოტი). Conversion Engine ნაგულისხმევად ჩართულია.",
          engineEnabled: "Conversion Engine ჩართული",
          recordTimelineEvents: "კონვერსიის timeline მოვლენების ჩაწერა",
          safetyHeading: "უსაფრთხოების ფრაზების კატეგორიები",
          presets: {
            soft_conversion_coordinator: "რბილი კონვერსიის კოორდინატორი (ნაგულისხმევი)",
            luxury_clinic: "ლუქს კლინიკა",
            budget_clinic: "ბიუჯეტური კლინიკა",
            dental_tourism: "სტომატოლოგიური ტურიზმი",
            implant_focused: "იმპლანტზე ფოკუსი",
            cosmetic_dentistry: "ესთეტიკური სტომატოლოგია",
            international_patients: "საერთაშორისო მომხმარებლები",
            consultation_focused: "კონსულტაციაზე ფოკუსი",
          },
          intensity: {
            gentle: "რბილი — საინფორმაციო, ნდობა პირველ რიგში",
            balanced: "დაბალანსებული — აქტიური კოორდინატორი",
            proactive: "პროაქტიული — კონვერსიაზე ფოკუსი (არასოდეს თავდაჯერებული)",
          },
          ctaStyle: {
            soft: "რბილი — არასავალდებულო გაგრძელება",
            balanced: "დაბალანსებული — ვიზიტები და მომზადება",
            proactive: "პროაქტიული — ნათელი შემდეგი ნაბიჯი",
          },
          pricingBehavior: {
            educate_then_range: "ჯერ ახსნა, შემდეგ დიაპაზონი",
            range_only: "მხოლოდ მოკლე დიაპაზონი",
            defer_to_coordinator: "კოორდინატორზე გადაცემა",
          },
          nextStep: {
            collect_xray: "რენტგენის / გამოსახულების მოთხოვნა",
            book_consultation: "კონსულტაციის დაჯავშნა",
            start_whatsapp: "WhatsApp საუბრის დაწყება",
            schedule_visit: "კლინიკაში ვიზიტის დაგეგმვა",
            collect_user_info: "მომხმარებლის ინფორმაციის შეგროვება",
            explain_treatment_process: "მკურნალობის პროცესის ახსნა",
          },
        },
        sedationAvailable: "სედაცია ხელმისაწვდომია",
        weekendAvailability: "შაბათ-კვირა",
        sameDayTreatment: "იმავე დღეს მკურნალობა",
        airportTransfer: "აეროპორტის ტრანსფერი",
        depositRequired: "საჭიროა დეპოზიტი",
        installments: "განვადება",
        financing: "დაფინანსება",
        creditCard: "საკრედიტო ბარათი",
        autonomyIntro: "აირჩიეთ AI-ის დამოუკიდებლობა. სამედიცინო თემები ყოველთვის საჭიროებს ადამიანს.",
        autonomyCategory: "კატეგორია",
        autonomyLevel: "დონე",
        safetyIntro: "ყოველთვის საჭიროა ადამიანის შემოწმება:",
        handoffIntro: "მონიშვნისას AI წყვეტს ავტოპასუხს და გაფრთხილებს გუნდს.",
        workflowJourneysHint: "ისწავლეთ AI-ს, როგორ მიმდინარებს ჩვეულებრივ მკურნალობა თქვენს კლინიკაში.",
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
          angryUser: "გაბრიტებული მომხმარებელიი",
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
        langs: { en: "ინგლისური", tr: "თურქული", ru: "რუსული", ka: "ქართული", ar: "არაბული", de: "გერმანული", fr: "ფრანგული" },
        ui: {
          usedByAi: "გამოიყენება AI პასუხებში",
          usedByAiTitle: "ეს ველი კვებავს AI ორკესტრაციის ფენას",
          usedByAiSection: "AI იყენებს",
          seeExample: "მაგალითის ნახვა",
          aiPrefix: "AI:"
        },
        visibility: {
          patient_visible: { short: "პაციენტისთვის ხილული", label: "შეიძლება გამოჩნდეს პაციენტის შეტყობინებებში" },
          ai_reply: { short: "AI პასუხები", label: "გამოიყენება AI პასუხებში" },
          internal: { short: "შიდა", label: "მხოლოდ შიდა / ოპერაციული" }
        },
        options: {
          toneStyle: {
            warm_professional: "თბილი + პროფესიონალური",
            clinical_concise: "კლინიკური და მოკლე",
            friendly_casual: "მეგობრული და თავისუფალი",
            luxury_premium: "ლუქსი / პრემიუმ"
          },
          signatureStyle: {
            name_only: "მხოლოდ ასისტენტის სახელი",
            name_clinic: "სახელი + კლინიკა",
            none: "ხელმოწერის გარეშე"
          }
        },
        sectionHelp: {
          aiProfile: {
            intro: "მრავალენოვანი AI ორკესტრაცია — ჩართეთ ენები და დაამატეთ არასავალდებულო ლოკალიზებული ტექსტი მომხმარებლისთვის. ოპერაციული ცოდნა (ბრენდები, ფასები, workflow) რჩება ერთ წყაროში; AI ლოკალიზაციას პასუხის დროს აკეთებს.",
            aiUsageSummary: "ენის მიმართვა, ლოკალიზებული მისალმება/ხელმოწერები და კოორდინატორის prompt-ების ლოკალიზაციის სახელმძღვანელო."
          },
          conversionCoordinator: {
            intro: "ნდობაზე დაფუძნებული რბილი კონვერსია — ტონი, CTA, ფასები და აკრძალული ფრაზები. არა გაყიდვების ბოტი; Conversion Engine მართავს კოორდინატორის პასუხებს.",
            aiUsageSummary: "სტრატეგიის ბლოკი კოორდინატორის საუბრებში; არასავალდებულო timeline ანალიტიკა.",
          },
          materials: {
            intro: "რომელ ბრენდებსა და მასალებს იყენებთ. AI ახსნის ვარიანტებს გამოგონილი ბრენდების გარეშე.",
            aiUsageSummary: "საგანმანათლებლო პასუხები იმპლანტებზე, ცირკონიუმზე, ლაბორატორიებსა და გარანტიაზე."
          },
          travel: {
            intro: "პარტნიორი სასტუმროები კვებავს AI სამედიცინო მოგზაურობის კოორდინატორს — საუბარზე მაქს. 3 აქტიური ობიექტი იზიარება AI-თან (ვექტორული DB არა).",
            aiUsageSummary: "სამედიცინო მოგზაურობის კოორდინაცია, სასტუმროს რეკომენდაციები და ტრანსფერის კითხვები."
          },
          logistics: {
            intro: "სამუშაო საათები, პასუხის დრო და პრაქტიკული კლინიკის ოპერაციები.",
            aiUsageSummary: "ჩაწერა, ხელმისაწვდომობა, გადაუდებელი მიმართვა და SLA fallback."
          },
          payment: {
            intro: "დეპოზიტი, დაფინანსება, დაბრუნება. AI ახსნის პოლიტიკას — არ აღებს გარანტიას გამონაკლისებზე.",
            aiUsageSummary: "გადახდისა და პოლიტიკის კითხვები; დაბრუნებაზე ადამიანზე გადაცემა."
          },
          workflow: {
            intro: "ვიზიტების ხანგრძლივობა, განკურნება და მკურნალობის შემდგომი კოორდინაცია. მხოლოდ ოპერაციული — არა დიაგნოზი.",
            aiUsageSummary: "მკურნალობის პროცესი, აღდგენა, follow-up და ოპერაციის შემდგომი კითხვები."
          },
          aiSafety: {
            intro: "რამდენად დამოუკიდებლად შეუძლია AI-ს ქმედება. სამედიცინო თემები ყოველთვის საჭიროებს ადამიანის შემოწმებას.",
            aiUsageSummary: "ორკესტრაცია: ავტოპასუხი, მხოლოდ შეთავაზება ან გამორთული თემატურად."
          },
          handoff: {
            intro: "როდის უნდა შეჩერდეს AI და გაგაფრთხილოთ კოორდინატორი ან ექიმი.",
            aiUsageSummary: "ავტომატური ესკალაციის ტრიგერები საუბარში."
          },
          internalNotes: {
            intro: "კლინიკის პოზიციონირება და სტრატეგია. AI ემთხვევა თქვენს ბრენდს — მომხმარებლისთვის არ ჩანს ზუსტად.",
            aiUsageSummary: "prompt-ის კონტექსტი ტონის, პრიორიტეტებისა და აქცენტებისთვის."
          }
        },
        autonomyLevels: {
          OFF: "გამორთული",
          SUGGEST_ONLY: "მხოლოდ შეთავაზება",
          AUTO_REPLY: "ავტოპასუხი",
          FULLY_AUTONOMOUS: "სრული ავტონომია"
        },
        fieldHelp: {
          supportedLanguages: {
            label: "მრავალენოვანი AI მხარდაჭერა",
            helper: "ჩართეთ ენები AI ორკესტრაციისთვის. ოპერაციული მონაცემები რჩება ერთ ადგილას — AI ლოკალიზაციას აკეთებს ბრენდებზე, ფასებსა და ლოჯისტიკაზე პასუხის დროს.",
            aiUsage: "მომხმარებლის ენის ამოცნობა, პასუხის ენა და პერსონალზე მიმართვის მინიშნებები.",
            example: "ძირითადი ინგლისური; dental tourism-ისთვის ქართული, თურქული, რუსული."
          },
          displayNameLocalized: {
            label: "ასისტენტის სახელი (ლოკალიზებული)",
            helper: "არასავალდებულო ასისტენტის სახელები ენების მიხედვით. ცარიელი დატოვეთ — AI ინგლისურიდან თარგმნის.",
            aiUsage: "მისალმება და ხელმოწერა მომხმარებლის ენაზე.",
            example: "en: DentX Care Team · ka: DentX მომხმარებელითა მხარდაჭერა"
          },
          welcomeMessageLocalized: {
            label: "მისალმების შეტყობინება (ლოკალიზებული)",
            helper: "არასავალდებულო გახსნის შაბლონები ენების მიხედვით — MVP-სთვის არ არის სავალდებულო.",
            aiUsage: "პირველი კონტაქტის ტონი და კლინიკის წარდგენა.",
            placeholder: "მოკლე მისალმება თითოეულ ჩართულ ენაზე"
          },
          toneStyle: {
            label: "ტონი / სტილი",
            helper: "ზოგადი კომუნიკაციის სტილი მომხმარებელითან საუბარში.",
            aiUsage: "ანგარიშს უწევს სიმჭვირვალეს, ფორმალობასა და ლუქსის დონეს პასუხებში.",
            example: "საერთაშორისო dental tourism-ისთვის თბილი + პროფესიონალური."
          },
          signatureStyle: {
            label: "ხელმოწერის სტილი",
            helper: "როგორ ხელმოეწერება შეტყობინებები ბოლოში.",
            aiUsage: "ემატება AI-ის მიერ შექმნილ მომხმარებლის შეტყობინებებს."
          },
          profileTags: {
            label: "პროფილის ტეგები",
            helper: "მოკლე ტეგები კლინიკის ატმოსფეროზე (ლუქსი, სწრაფი პასუხი და ა.შ.).",
            aiUsage: "შიდა ტონის მინიშნებები — მომხმარებლისთვის პირდაპირ არ ჩანს.",
            placeholder: "ლუქსი, მეგობრული, პრემიუმ, სწრაფი_პასუხი",
            example: "პრემიუმ, მეგობრული, სწრაფი_პასუხი"
          },
          preset: {
            label: "კლინიკის პრესეტი",
            helper: "მზა კონვერსიის სტილი კლინიკის ტიპისთვის — ტონი, CTA და ფასების ქცევა.",
            aiUsage: "იტვირთება Conversion Engine სტრატეგიის ბლოკში.",
          },
          coordinatorIntensity: {
            label: "კოორდინატორის ინტენსივობა",
            helper: "რამდენად აქტიურად მიუძღვება AI შემდეგ ნაბიჯებს, ნდობის შენარჩუნებით.",
            aiUsage: "კონვერსიის პოზა: რბილი, დაბალანსებული ან პროაქტიული.",
          },
          ctaStyle: {
            label: "მოქმედებისკენ მოწოდების სტილი",
            helper: "რამდენად პირდაპირ შესთავაზოს შემდეგი ნაბიჯები (რენტგენი, კონსულტაცია, WhatsApp, ვიზიტი).",
            aiUsage: "ფორმირებს პასუხების დასასრულს და follow-up მოწოდებებს.",
          },
          pricingBehavior: {
            label: "ფასების ქცევა",
            helper: "ჯერ ახსნა და დიაპაზონი, მხოლოდ დიაპაზონი ან კოორდინატორზე გადაცემა.",
            aiUsage: "აკონტროლებს პასუხებს ღირებულების შესახებ.",
          },
          nextStepPreference: {
            label: "სასურველი შემდეგი ნაბიჯები",
            helper: "რომელი ნაბიჯები უნდა პრიორიტეტული იყოს, როცა შესაფერისია (არა ყველა ერთად).",
            aiUsage: "მართავს CTA-ის არჩევას კოორდინატორის საუბრებში.",
          },
          forbidden_guarantees: {
            label: "აკრძალული გარანტიები",
            helper: "ფრაზები, რომლებიც AI-ს არასოდეს უნდა გამოიყენოს (თითო ხაზზე ერთი).",
            aiUsage: "უსაფრთხოების ფილტრი შედეგებისა და გარანტიის ენისთვის.",
            placeholder: "გარანტირებული შედეგი\n100% წარმატება",
          },
          forbidden_diagnosis: {
            label: "აკრძალული დიაგნოზის ენა",
            helper: "დიაგნოზის ან კატეგორიული ფორმულირებები ბლოკირებისთვის.",
            aiUsage: "პასუხები რჩება ოპერაციული, არა კლინიკური დიაგნოზი.",
          },
          forbidden_claims: {
            label: "აკრძალული მარკეტინგული განცხადებები",
            helper: "გადაჭარბებული ან შედარებითი განცხადებები, რომლებიც უნდა ავიცილოთ.",
            aiUsage: "ბრენდისთვის უსაფრთხო მომხმარებლის შეტყობინებები.",
          },
          forbidden_urgency: {
            label: "აკრძალული სასწრაფო ზეწოლა",
            helper: "აგრესიული სასწრაფო ფორმულირებები ბლოკირებისთვის.",
            aiUsage: "თავიდან აგაცილებთ თავდაჯერებულ ან საშიში კონვერსიას.",
          },
          implantBrands: {
            label: "იმპლანტის ბრენდები",
            helper: "ბრენდები, რომლებსაც რუტინულად იყენებთ. AI ადარებს მაღალი დონით — არა სამედიცინო რეკომენდაცია.",
            aiUsage: "ბრენდისა და ვარიანტის ახსნები.",
            placeholder: "Straumann, Nobel, Osstem"
          },
          premiumBrands: {
            label: "პრემიუმ ბრენდები",
            helper: "უმაღლესი სეგმენტის ბრენდები, თუ გთავაზობთ.",
            aiUsage: "პრემიუმ ვარიანტების შედარება ან upsell."
          },
          zirconiumTypes: {
            label: "ცირკონიუმის ტიპები",
            helper: "გვირგვინის/ფირისთვის გამოყენებული მასალები.",
            aiUsage: "ესთეტიკისა და გვირგვინის მასალის კითხვები.",
            placeholder: "E.max, მრავალფენიანი ცირკონია"
          },
          labPartners: {
            label: "ლაბორატორიის პარტნიორები",
            helper: "კლინიკის ან პარტნიორი ლაბორატორიები — ნდობას აძლიერებს პროცესის პასუხებში.",
            aiUsage: "ოპერაციული პროცესის ახსნები."
          },
          warrantyInformation: {
            label: "გარანტიის პოლიტიკა",
            helper: "გარანტიის პირობების შეჯამება. AI არ გამოიგონებს იურიდიულ გარანტიებს.",
            aiUsage: "გარანტიისა და უზრუნველყოფის კითხვები.",
            placeholder: "10 წლის იმპლანტის გარანტია ყოველწლიური შემოწმებით"
          },
          sedationAvailability: {
            label: "სედაცია ხელმისაწვდომია",
            helper: "სედაცია შეუსაბამო მომხმარებლებისთვის.",
            aiUsage: "კომფორტისა და შფოთვის შესახებ კითხვები."
          },
          weekdayHours: {
            label: "სამუშაო დღეების საათები",
            helper: "როდის არის კლინიკა ჩვეულებრივ ღია ჩაწერისა და პასუხისთვის.",
            aiUsage: "ჩაწერისა და „როდის ხართ ღია?“ კითხვები.",
            placeholder: "09:00 – 18:00"
          },
          timezone: {
            label: "კლინიკის დროის სარტყელი",
            helper: "IANA timezone ჩაწერისა და SLA გამოთვლისთვის.",
            aiUsage: "საერთაშორისო მომხმარებლებისთვის დროისა და პასუხის ფანჯრის კონვერტაცია.",
            placeholder: "Europe/Istanbul"
          },
          averageResponseSlaMinutes: {
            label: "პასუხის SLA (წუთები)",
            helper: "პერსონალის სამიზნე პასუხის დრო. AI fallback-ისთვის — მომხმარებლისთვის არ ჩანს.",
            aiUsage: "SLA ავტომატიზაცია და კოორდინატორზე ესკალაცია.",
            placeholder: "120"
          },
          emergencyContact: {
            label: "გადაუდებელი კონტაქტი",
            helper: "ტელეფონი ან ინსტრუქცია გადაუდებელი შემთხვევებისთვის. AI არ აძლევს სამედიცინო რჩევას.",
            aiUsage: "გადაუდებელი / მძიმე ტკივილის მიმართვა (ადამიანზე გადაცემით).",
            placeholder: "+995 … / WhatsApp გადაუდებელი ხაზი"
          },
          transportationNotes: {
            label: "ტრანსპორტის შენიშვნები",
            helper: "აეროპორტიდან შეხვედრა, VIP ტრანსფერი, შატლის დეტალები.",
            aiUsage: "მოგზაურობისა და ჩამოსვლის კოორდინაცია.",
            example: "უფასო აეროპორტის შეხვედრა ორშ–შაბ მკურნალობის მომხმარებლებისთვის."
          },
          refundPolicy: {
            label: "დაბრუნების პოლიტიკა",
            helper: "სტანდარტული დაბრუნების წესები. AI აჯამებს — კონფლიქტზე ადამიანზე გადაცემა.",
            aiUsage: "დაბრუნების კითხვები (კონფლიქტში ესკალაცია).",
            placeholder: "დეპოზიტი ბრუნდება მკურნალობამდე 14+ დღით ადრე გაუქმებისას"
          },
          cancellationPolicy: {
            label: "გაუქმების პოლიტიკა",
            helper: "ჩაწერის ან პაკეტის გაუქმების პირობები.",
            aiUsage: "ჩაწერისა და გაუქმების კითხვები."
          },
          positioningNotes: {
            label: "პოზიციონირების პუნქტები",
            helper: "როგორ გსურთ კლინიკის პოზიციონირება. ერთი პუნქტი ხაზზე.",
            aiUsage: "აყალიბებს AI-ის აქცენტს — პირდაპირ არ იკორება.",
            example: "ბუნებრივ ესთეტიკაზე ვფოკუსირდებით\nუმეტესი საერთაშორისო მომხმარებელიი რჩება 5–7 დღე"
          },
          freeformNotes: {
            label: "დამატებითი შიდა შენიშვნები",
            helper: "სხვა ინფორმაცია, რაც პერსონალმა უნდა იცოდეს AI-ის კოორდინაციისას.",
            aiUsage: "დამატებითი ორკესტრაციის კონტექსტი."
          },
          protocol_postOpNotes: {
            label: "ოპერაციის შემდგომი კოორდინაციის შენიშვნები",
            helper: "აღწერეთ, როგორ ხელმძღვანელობთ მომხმარებელიებს მკურნალობის შემდეგ. AI შეუძლია გამოიყენოს აღდგენის, follow-up-ის, შეშუპების, კვებისა და კონტროლის კითხვებზე.",
            aiUsage: "ოპერაციის შემდგომი კოორდინაციის პასუხები — არ ცვლის ექიმის რჩევას.",
            placeholder: "იმპლანტის ოპერაციის შემდეგ 48 საათი მკაცრი საკვებისგან თავი შევიკავოთ.",
            example: "რბილი დიეტა 48 სთ, ყინვა პირველ დღეს, კონტროლი ფრეხამდე, WhatsApp დღე 3."
          }
        }
      },

      travel: {
        pageTitle: "მოგზაურობა და საცხოვრებელი — Clinifly Admin",
        breadcrumbSettings: "კლინიკის პარამეტრები",
        breadcrumbCurrent: "მოგზაურობა და საცხოვრებელი",
        title: "მოგზაურობა და საცხოვრებელი",
        lead: "პარტნიორი სასტუმროები კვებავს AI სამედიცინო მოგზაურობის კოორდინატორს — საუბარზე მაქს. 3 აქტიური ობიექტი იზიარება AI-თან (ვექტორული DB არა).",
        partnerHotels: "პარტნიორი სასტუმროები",
        addHotel: "+ სასტუმროს დამატება",
        editHotel: "სასტუმროს რედაქტირება",
        emptyList: "პარტნიორი სასტუმრო ჯერ არ არის. დაამატეთ პირველი ობიექტი, რომ AI-მ რეკომენდაცია გაუკეთოს.",
        loading: "იტვირთება…",
        futureNote: "მომავალში: აეროპორტის ტრანსფერი, მძღოლები, თარგმანები, აპარტამენტები — არქიტექტურა მზადაა, ჯერ არ არის ჩართული.",
        saveHotel: "სასტუმროს შენახვა",
        cancel: "გაუქმება",
        delete: "წაშლა",
        edit: "რედაქტირება",
        deleteConfirm: "წავშალოთ ეს სასტუმრო?",
        openMaps: "რუკის გახსნა",
        minFromClinic: "წთ კლინიკიდან",
        chipPreferred: "პრიორიტეტული",
        chipActive: "აქტიური",
        chipInactive: "არააქტიური",
        chipTransfer: "ტრანსფერი",
        chipBreakfast: "საუზმე",
        fieldName: "სახელი *",
        fieldPrice: "ფასის დიაპაზონი (დაახლ.)",
        fieldDistance: "მანძილი (წუთები კლინიკიდან)",
        fieldSort: "სორტირება",
        fieldAddress: "მისამართი",
        fieldMaps: "Google Maps URL",
        fieldBooking: "ბუქინგის URL (არასავალდებულო)",
        fieldLangs: "მხარდაჭერილი ენები",
        fieldDiscount: "კლინიკის ფასდაკლების შენიშვნები",
        fieldNotes: "შიდა შენიშვნები",
        checkTransfer: "ტრანსფერი ჩართული / შესაძლებელია",
        checkBreakfast: "საუზმე ჩართული",
        checkPreferred: "პრიორიტეტული პარტნიორი",
        checkActive: "აქტიური (ხილული AI-სთვის)",
        phName: "Radisson Blu თბილისი",
        phPrice: "120–180 USD / ღამე",
        phDistance: "8",
        phAddress: "Rose Revolution Square…",
        phMaps: "https://maps.google.com/…",
        phLangs: "en, ru, ka",
        phDiscount: "10% კლინიკის პარტნიორი განაკვეთი",
        phNotes: "მხოლოდ კოორდინატორის შენიშვნები",
        errLoad: "ჩატვირთვა ვერ მოხერხდა",
        errDelete: "წაშლა ვერ მოხერხდა",
        errSave: "შენახვა ვერ მოხერხდა"
      },

      treatment: {
        patientName: "მომხმარებლის სახელი (არჩევა)",
        selectPatient: "— აირჩიეთ მომხმარებელიი —",
        patientHelp: "ავტომატურად ივსება მომხმარებლების სიიდან. მომხმარებლის შეცვლა ხელახლა ტვირთავს მონაცემებს.",
        noPatientSelected: "მომხმარებელიი არ არის არჩეული.",
        loadingTreatments: "მკურნალობის გეგმის ჩატვირთვა...",
        noTreatments: "ამ მომხმარებლისთვის გეგმა ვერ მოიძებნა.",
        addTreatment: "მკურნალობის დამატება",
        saveTreatment: "შენახვა",
        treatmentSaved: "✅ შენახულია!",
        treatmentDeleted: "✅ წაშლილია!",
        confirmDelete: "წავშალოთ ეს ჩანაწერი?",
        pageTitle: "მკურნალობა - Clinifly Admin",
        upperJaw: "ზედა ყბა",
        lowerJaw: "ქვედა ყბა",
        fdiUpper: "FDI 11–18 / 21–28",
        fdiLower: "FDI 31–38 / 41–48",
        selectedTooth: "არჩეული კბილი:",
        selToothHint: "დააჭირეთ კბილს პროცედურის დასამატებლად.",
        clearSelection: "არჩევის გასუფთავება",
        procedureType: "პროცედურის ტიპი",
        loadingProcedures: "იტვირთება...",
        statusLabel: "სტატუსი",
        dateLabel: "თარიღი",
        timeLabel: "დრო",
        datePolicy: "თარიღის პოლიტიკა",
        datePolicyManual: "MANUAL (შეხსენება)",
        datePolicyAuto: "AUTO (ავტომატური თარიღი)",
        priceOptional: "ფასი (არასავალდებულო)",
        currencyLabel: "ვალუტა",
        quantityLabel: "რაოდენობა",
        chairNo: "სავარძლის №",
        doctorLabel: "ექიმი",
        doctorSelectOptional: "-- ექიმი (არასავალდებულო) --",
        addProcedure: "+ პროცედურის დამატება",
        diagnosesOnTooth: "დიაგნოზები ამ კბილზე",
        addDiagnosisBtn: "+ დიაგნოზები",
        newDiagnosisTitle: "ახალი დიაგნოზი",
        icdCodeLabel: "ICD-10 კოდი",
        descriptionLabel: "აღწერა",
        toothNoLabel: "კბილი №",
        toothPlaceholderAuto: "ავტო",
        notesOptionalLabel: "შენიშვნა (არასავალდებულო)",
        notesPlaceholder: "არასავალდებულო შენიშვნა...",
        proceduresOnTooth: "პროცედურები ამ კბილზე",
        treatmentEventsTitle: "🦷 მოვლენები (კალენდარი)",
        treatmentEventsHelp: "მოვლენები ინახება treatment_events ცხრილში.",
        eventTitlePlaceholder: "იმპლანტი, დღე 1",
        eventDescPlaceholder: "კტ + იმპლანტი",
        teTypeTreatment: "მკურნალობა",
        teTypeConsult: "კონსულტაცია",
        teTypeFollowup: "კონტროლი",
        teTypeLab: "ლაბორატორია / სკანი",
        addEvent: "➕ მოვლენის დამატება",
        eventListTitle: "მოვლენების სია",
        thDateTime: "თარიღი/დრო",
        thType: "ტიპი",
        thTitle: "სათაური",
        patientToothDiagnoses: "მომხმარებლის კბილის დიაგნოზები",
        badgeToothDoctor: "კბილი № + ექიმის დიაგნოზი",
        noDiagnosisSummary: "დიაგნოზის ჩანაწერი არ არის.",
        emptyStateTitle: "ჩანაწერი ჯერ არ არის",
        emptyStateSub: "მონაცემები გამოჩნდება ჩატვირთვის შემდეგ.",
        selectPatientAbove: "ზემოთ აირჩიეთ მომხმარებელიი.",
        loadingTreatmentsMsg: "იტვირთება...",
        loadFailed: "ჩატვირთვა ვერ მოხერხდა: {error}",
        noRecordsYet: "ჩანაწერი არ არის. აირჩიეთ კბილი და დაამატეთ პროცედურა.",
        loadedSummary: "{teethCount} კბილზე სულ {procCount} პროცედურა ჩაიტვირთა.",
        headerTitle: "მკურნალება",
        loadError: "შეცდომა: {error}",
        selectToothFirst: "⚠️ ჯერ აირჩიეთ კბილი",
        toothLocked: "კბილი ჩათვლილია (დაბლოკილი). ახალი პროცედურა შეუძლებელია.",
        selectProcedureType: "აირჩიეთ პროცედურის ტიპი.",
        invalidDateTime: "არასწორი თარიღი/დრო.",
        diagCodeOrDesc: "შეიყვანეთ ICD-10 კოდი ან აღწერა.",
        saveFailedWithMsg: "შენახვა ვერ მოხერხდა: {error}",
        deleteFailedWithMsg: "წაშლა ვერ მოხერხდა: {error}",
        errorWithMsg: "შეცდომა: {error}",
        saveAllSuccess: "ყველა პროცედურა შენახულია ✅",
        saveAllError: "შენახვის შეცდომა: {error}",
        deleteBtn: "წაშლა",
        eventsEmpty: "მოვლენები არ არის.",
        procLineTooth: "კბილი {tooth} • ",
        selToothHintLocked: "⛔ ეს კბილი ამოღებულია (locked). ახალი პროცედურები არ ემატება. მხოლოდ ისტორია.",
        pickToothFromChart: "აირჩიეთ კბილი ზემოთ არსებული სქემიდან.",
        noProcOnTooth: "ამ კბილზე ჯერ პროცედურები არ არის.",
        noDiagOnTooth: "ამ კბილზე დიაგნოზის ჩანაწერი არ არის.",
        noDescription: "აღწერა არ არის",
        diagGroupTooth: "🦷 კბილი {tooth}",
        diagGroupGeneral: "🦷 ზოგადი დიაგნოზები",
        diagNotAdded: "დიაგნოზები არ არის დამატებული",
        toothDiagCountTitle: "ამ კბილზე {count} დიაგნოზის ჩანაწერია",
        datePrefix: "თარიღი:",
        chairLabel: "სავარძელი",
        editInlineTitle: "რედაქტირება ხაზში",
        statusSelectTitle: "აირჩიეთ სტატუსი",
        statusCycleTitle: "დააჭირეთ სტატუსის შესაცვლელად (PLANNED → ACTIVE → COMPLETED → CANCELLED → PLANNED)",
        inlineProcTypePh: "პროცედურის ტიპი",
        inlineUnitPricePh: "ერთეულის ფასი",
        inlineQtyPh: "რაოდ.",
        inlineChairPh: "სავარძელი №",
        inlineDoctorPick: "-- აირჩიეთ ექიმი --",
        deleteTitle: "წაშლა",
        selToothHintActive: "დააჭირეთ კბილს პროცედურის დასამატებლად.",
        status: {
          PLANNED: "დაგეგმილია",
          ACTIVE: "მიმდინარე",
          COMPLETED: "დასრულებულია",
          CANCELLED: "გაუქმებულია"
        }
      },
      timeline: {
        tooth: "კბილი",
        procedure: "პროცედურა",
        status: "სტატუსი"
      },
      date: {
        monthsShort: ["იან", "თებ", "მარ", "აპრ", "მაი", "ივნ", "ივლ", "აგვ", "სექ", "ოქტ", "ნოე", "დეკ"],
        weekdays: ["კვ", "ორ", "სამ", "ოთხ", "ხუთ", "პარ", "შაბ"]
      },
      files: {
        pageTitle: "Admin – მომხმარებლის ფაილები",
        title: "📁 მომხმარებლის ფაილები",
        selectPatient: "მომხმარებელიი:",
        selectPlaceholder: "მომხმარებელიი აირჩიეთ...",
        filterAll: "ყველა",
        filterPhoto: "📸 ფოტო",
        filterXray: "🦷 რენტგენი",
        filterPdf: "📄 PDF",
        filterChat: "💬 ჩათი",
        upload: "ატვირთვა",
        empty: "ფაილები ვერ მოიძებნა.",
        selectToView: "ფაილების სანახავად მომხმარებელიი აირჩიეთ.",
        badgeImage: "ფოტო",
        badgeXray: "რენტგენი",
        badgePdf: "PDF",
        badgeFile: "ფაილი",
        badgeChat: "ჩათი",
        download: "ჩამოტვირთვა"
      },
      doctorListV2: {
        pageTitle: "👨‍⚕️ ექიმები",
        documentTitle: "ექიმები - Clinifly Admin",
        statPending: "ლოდინი",
        statApproved: "დამოწმებული",
        statRejected: "უარყოფილი",
        statTotal: "სულ",
        searchPlaceholder: "ძიება სახელით, email-ით ან ტელეფონით...",
        filterAll: "ყველა სტატუსი",
        filterOptionPending: "ლოდინში",
        filterOptionApproved: "დამოწმებული",
        filterOptionActive: "აქტიური",
        filterOptionRejected: "უარყოფილი",
        refresh: "↺ განახლება",
        loading: "იტვირთება...",
        empty: "ექიმის ჩანაწერები ჯერ არ არის.",
        errorHttp: "HTTP {status}",
        errorLoad: "ჩატვირთვა ვერ მოხერხდა",
        sectionProfessional: "პროფესია",
        labelExperience: "გამოცდილება",
        labelUniversity: "უნივერსიტეტი",
        labelGraduation: "დამთავრება",
        labelProfile: "პროფილი",
        labelBio: "ბიო",
        profilePublic: "🌐 საჯარო",
        profilePrivate: "🔒 დამალული",
        sectionSpecialty: "სპეციალიზაცია",
        sectionLanguages: "ენები",
        sectionProcedures: "პროცედურები",
        notSpecified: "არ არის მითითებული",
        yearsCount: "{years} წ",
        dash: "—",
        status: {
          PENDING: "ლოდინში",
          APPROVED: "დამოწმებული",
          ACTIVE: "აქტიური",
          REJECTED: "უარყოფილი"
        },
        btnApprove: "✅ დადასტურება",
        btnReject: "❌ უარყოფა",
        confirmApprove: "დარწმუნებული ხართ, რომ გინდათ ამ ექიმის დამოწმება?",
        confirmReject: "დარწმუნებული ხართ, რომ გინდათ განაცხადის უარყოფა?",
        approvedAlert: "✅ ექიმი დამოწმებულია!",
        rejectedAlert: "განაცხადი უარყოფილია.",
        errorGeneric: "შეცდომა"
      },
      chat: {
        documentTitle: "ჩატი - Clinifly Admin",
        pageHeading: "💬 Clinifly Admin – ჩატი",
        title: "შეტყობინებები",
        patientsHeading: "მომხმარებლები",
        loading: "იტვირთება...",
        selectPatient: "აირჩიეთ მომხმარებელიი",
        noPatients: "მომხმარებლები ჯერ არ არის",
        unnamed: "უსახელო",
        placeholder: "შეიყვანეთ შეტყობინება...",
        send: "გაგზავნა",
        sending: "იგზავნება...",
        noMessages: "ჯერ შეტყობინებები არ არის",
        newMessage: "ახალი შეტყობინება",
        youJoined: "შეუერთეთ ჩატს",
        photo: "ფოტო",
        file: "ფაილი",
        photoFile: "📷 ფოტო",
        fileAttach: "📎 ფაილი",
        download: "ჩამოტვირთვა",
        uploadHelp: "მხარდაჭერილი: JPG, PNG, HEIC (მაქს 10 მბ) • PDF/DOC/DOCX/TXT/XLS/XLSX (მაქს 20 მბ) • ZIP (მაქს 50 მბ)",
        sentOk: "✓ გაიგზავნა",
        uploadError: "✗ შეცდომა",
        errNoToken: "❌ ადმინ ტოკენი არ არის. ჯერ შედით.",
        errTokenList: "საჭიროა ადმინ ტოკენი",
        errAuth: "❌ ავტორიზაცია ვერ მოხერხდა. ხელახლა შედით.",
        errAuthShort: "❌ ავტორიზაცია ვერ მოხერხდა",
        errUnknown: "უცნობი შეცდომა",
        errLoadList: "❌ მომხმარებლების ჩატვირთვა ვერ მოხერხდა: {message}",
        errLoadMessages: "შეტყობინებების ჩატვირთვა ვერ მოხერხდა",
        errLoadMessagesFull: "❌ შეტყობინებების ჩატვირთვა ვერ მოხერხდა: {message}",
        errSelectFirst: "❌ ჯერ აირჩიეთ მომხმარებელიი",
        errNoTokenSend: "❌ ადმინ ტოკენი არ არის",
        errSend: "შეტყობინების გაგზავნა ვერ მოხერხდა",
        errSendFull: "❌ გაგზავნა ვერ მოხერხდა: {message}",
        errFileUpload: "❌ ფაილის ატვირთვა ვერ მოხერხდა: {message}",
        errSession: "❌ სესია ამოიწურა. ხელახლა შედით.",
        errForbidden: "❌ ფაილის ტიპი აკრძალულია: {ext}.",
        errMime: "❌ ფაილის ტიპი ვერ განისაზღვრა. სცადეთ სხვა ფაილი.",
        errImageFmt: "❌ JPG, PNG, HEIC – მაქს 10 მბ",
        errDocFmt: "❌ PDF, DOC/DOCX, TXT, XLS/XLSX, ZIP",
        errPhotoSize: "❌ ფოტო 10 მბ-ზე ნაკლები",
        errZipSize: "❌ ZIP 50 მბ-ზე ნაკლები",
        errDocSize: "❌ დოკუმენტი 20 მბ-ზე ნაკლები",
        errSelectPatient: "❌ ჯერ აირჩიეთ მომხმარებელიი",
        before: "უწინ",
        after: "შემდეგ",
        doctorReview: "👨‍⚕️ ექიმის მიმოხილვა",
        defaultClinic: "კლინიკა",
        defaultPhoto: "ფოტო",
        defaultFile: "ფაილი",
        navClinicSettings: "კლინიკის პარამეტრები"
      },
      leads: {
        documentTitle: "ლიდების მართვა — Clinifly Admin",
        pageTitle: "ლიდების ინბოქსი",
        subtitle:
          "ერთ ნაკადზე ერთი პასუხისმგებელი ექიმი; კლინიკის გუნდს ხილვადობა შეტყობინებებიდან ინარჩუნებს.",
        backDashboard: "← პანელი",
        refreshList: "სიის განახლება",
        statusLoading: "იტვირთება…",
        statusUnassigned: "{count} ჩანაწერი",
        thPatient: "მომხმარებელიი",
        thContact: "კონტაქტი",
        thPreview: "ბოლო შეტყობინება",
        thAssign: "ექიმის მიბმა",
        thPrimary: "პასუხისმგებელი ექიმი",
        thLastActivity: "აქტივობა",
        thStatus: "სტატუსი",
        thActions: "მოქმედებები",
        empty: "ლიდები არ არის.",
        selectDoctor: "აირჩიეთ ექიმი…",
        assign: "მიბმა",
        reassign: "ხელახლა მიბმა",
        unassign: "მიბმის მოხსნა",
        openChat: "ჩათის გახსნა",
        badgeUnassigned: "დაუნიშნავი",
        badgePrimarySet: "ნიშნული დასმულია",
        primaryNone: "—",
        confirmUnassign: "პასუხისმგებელი ექიმის მიბმა მოვხსნათ?",
        successUnassigned: "მიბმა მოხსნილია.",
        errChooseDoctor: "ჯერ აირჩიეთ ექიმი.",
        successAssigned: "დაინიშნა.",
        errLoad: "ჩატვირთვის შეცდომა",
        showAssignedToggle: "დანიშნულების ჩვენება",
        assignedBadgePrefix: "Dr.",
        assignedOk: "დანიშნული:",
        assignDisabledHint: "ლიდი უკვე დანიშნულია.",
        autoAssignAll: "ყველა დაუნიშნავის ავტომიბმა",
        autoAssignSelected: "არჩეულების ავტომიბმა",
        autoAssignRunning: "ავტომიბმა მიმდინარეობს…",
        autoAssignDone: "დანიშნული: {assigned}, გამოტოვებული: {skipped}, შეცდომა: {failed}.",
        autoAssignDistributionPrefix: "განაწილება:",
        autoAssignPartialFail: "ზოგიერთი მიბმა ვერ მოხერხდა:",
        autoAssignAllConfirm: "ამ კლინიკის ყველა დაუნიშნავი ლიდი გადანაწილდეს დაბალანსებული წესით?",
        autoAssignNoneSelected: "აირჩიეთ მინიმუმ ერთი დაუნიშნავი ლიდის სტრიქონი.",
        selectAllUnassignedTitle: "ამ გვერდის ყველა დაუნიშნავი სტრიქონის არჩევა",
        leadRoutingSectionTitle: "ახალი ლიდის მარშრუტიზაცია",
        leadRoutingHelp:
          "ხელმოცარებულია ახალი ლიდის ნაკადის შექმნისას. არსებულ ნაკადებს და ხელით მიბმას არ ცვლის.",
        leadRoutingEnable: "ახალი ლიდების ავტომატური პასუხისმგებლის მიბმა",
        leadRoutingMode: "რეჟიმი",
        leadRoutingModeManual: "მხოლოდ ხელით — დაუნიშნავად",
        leadRoutingModeFixed: "ფიქსირებული ექიმი",
        leadRoutingModeRoundRobin: "რაუნდ-რობინი (უფლებამოსილი ექიმები)",
        leadRoutingModeBalanced: "დაბალანსებული (ყველაზე ნაკლები მიბმა)",
        leadRoutingFixedDoctor: "ფიქსირებული ექიმი",
        leadRoutingSave: "პარამეტრების შენახვა",
        leadRoutingSaved: "პარამეტრები შენახულია.",
        leadRoutingLoadError: "პარამეტრების ჩატვირთვა ვერ მოხერხდა.",
        leadRoutingTableMissing: "ცხრილი clinic_lead_routing_settings არ არის — გაუშვით migration.",
        tabNeedsAssignment: "მიბმა სჭირდება",
        tabRecentlyRouted: "ახლახან გადამისამართებული",
        tabAssigned: "დანიშნული",
        thChannel: "არხი",
        thAssignedAt: "დანიშნული",
        searchPlaceholder: "მომხმარებლის, ტელეფონის, შეტყობინების ძებნა…",
        channelMessenger: "Messenger",
        channelWhatsapp: "WhatsApp",
        channelWeb: "Web",
        channelUnknown: "სხვა",
        emptyNeedsAssignment: "ხელით მიბმას მომლოდინე ლიდები არ არის.",
        emptyRecentRouted: "ბოლო 24 საათში ავტომატურად გადამისამართებული ლიდები არ არის.",
        emptyAssigned: "დანიშნული ლიდები არ არის.",
        statusNeedsAssignment: "{count} ლიდი მიბმას ელის",
        statusRecentRouted: "{count} ახლახან გადამისამართებული ლიდი",
        statusAssigned: "{count} დანიშნული ლიდი",
        badgeNewRouted: "ახლახან გადამისამართებული",
      }
    }
  };

  /** localhost or ?adminI18nValidate=1 — compare top-level section keys across tr/en/ru/ka */
  function runOptionalTranslationParityCheck() {
    try {
      var h = typeof location !== 'undefined' ? String(location.hostname || '') : '';
      var validate =
        h === 'localhost' ||
        h === '127.0.0.1' ||
        h === '::1' ||
        (typeof location !== 'undefined' && /[?&]adminI18nValidate=1(?:&|$)/.test(location.search || ''));
      if (!validate || !translations || !translations.en || typeof translations.en !== 'object') return;
      var enKeys = Object.keys(translations.en).sort().join(',');
      ['tr', 'ru', 'ka'].forEach(function (L) {
        var o = translations[L];
        if (!o || typeof o !== 'object') {
          console.warn('[AdminI18n parity] missing language root:', L);
          return;
        }
        var keys = Object.keys(o).sort().join(',');
        if (keys !== enKeys) {
          var enList = Object.keys(translations.en);
          var missing = enList.filter(function (k) {
            return !Object.prototype.hasOwnProperty.call(o, k);
          });
          var extra = Object.keys(o).filter(function (k) {
            return !Object.prototype.hasOwnProperty.call(translations.en, k);
          });
          if (missing.length) {
            console.warn('[AdminI18n parity] ' + L + ' missing top-level sections vs en (' + missing.length + '):', missing.slice(0, 40));
          }
          if (extra.length) {
            console.warn('[AdminI18n parity] ' + L + ' extra top-level sections vs en (' + extra.length + '):', extra.slice(0, 40));
          }
        }
      });
    } catch (e) {
      /* ignore */
    }
  }

  runOptionalTranslationParityCheck();

  function emitI18nReady() {
    if (typeof document !== 'undefined' && document.dispatchEvent) {
      document.dispatchEvent(new Event("i18n:ready"));
    }
  }

  function emitAdminLanguageChanged(lang, meta) {
    if (typeof document === 'undefined' || !document.dispatchEvent) return;
    try {
      var detail = Object.assign({ lang: lang }, meta && typeof meta === 'object' ? meta : {});
      document.dispatchEvent(new CustomEvent('admin-language-changed', { detail: detail }));
    } catch (e) {
      /* ignore */
    }
  }

  function rerenderAll() {
    if (typeof window.renderDashboard === 'function') {
      try { window.renderDashboard(); } catch (e) { console.warn('renderDashboard', e); }
    }
    if (typeof window.applyScheduleStaticI18n === 'function' && window.i18n && typeof window.i18n.getLang === 'function') {
      try { window.applyScheduleStaticI18n(window.i18n.getLang()); } catch (e) { console.warn('applyScheduleStaticI18n', e); }
    }
    if (typeof window.renderGrid === 'function' && document.getElementById('calendarGrid')) {
      const container = document.getElementById('calendarGrid');
      if (container) container.innerHTML = '';
      const ap = (typeof window.allAppointments !== 'undefined' && window.allAppointments) ? window.allAppointments : [];
      const items = Array.isArray(ap) ? ap : [];
      const L = (window.i18n && typeof window.i18n.getLang === 'function') ? window.i18n.getLang() : 'en';
      try { window.renderGrid(items, L); } catch (e) { console.warn('renderGrid', e); }
    }
    if (typeof window.renderDoctors === 'function') {
      try { window.renderDoctors(); } catch (e) { console.warn('renderDoctors', e); }
    }
    if (typeof window.renderChat === 'function') {
      try { window.renderChat(); } catch (e) { console.warn('renderChat', e); }
    }
    const asyncAfter = [];
    if (typeof window.rerenderTreatment === 'function') {
      try {
        const p = window.rerenderTreatment();
        if (p && typeof p.then === 'function') asyncAfter.push(p);
      } catch (e) { console.warn('rerenderTreatment', e); }
    }
    if (typeof window.rerenderPatientsI18n === 'function') {
      try { window.rerenderPatientsI18n(); } catch (e) { console.warn('rerenderPatientsI18n', e); }
    }
    if (typeof window.rerenderLeads === 'function') {
      try { window.rerenderLeads(); } catch (e) { console.warn('rerenderLeads', e); }
    }
    if (typeof window.rerenderReferralsAdmin === 'function') {
      try { window.rerenderReferralsAdmin(); } catch (e) { console.warn('rerenderReferralsAdmin', e); }
    }
    if (typeof window.rerenderOpsProfile === 'function') {
      try { window.rerenderOpsProfile(); } catch (e) { console.warn('rerenderOpsProfile', e); }
    }
    if (typeof window.rerenderCoordinationCenter === 'function') {
      try { window.rerenderCoordinationCenter(); } catch (e) { console.warn('rerenderCoordinationCenter', e); }
    }
    if (typeof window.rerenderTravelPage === 'function') {
      try { window.rerenderTravelPage(); } catch (e) { console.warn('rerenderTravelPage', e); }
    }
    if (typeof window.rerenderSettings === 'function') {
      try {
        const p = window.rerenderSettings();
        if (p && typeof p.then === 'function') asyncAfter.push(p);
      } catch (e) { console.warn('rerenderSettings', e); }
    }
    if (typeof window.rerenderLoginPage === 'function') {
      try { window.rerenderLoginPage(); } catch (e) { console.warn('rerenderLoginPage', e); }
    }
    if (typeof window.rerenderRegisterPage === 'function') {
      try { window.rerenderRegisterPage(); } catch (e) { console.warn('rerenderRegisterPage', e); }
    }
    if (typeof window.rerenderDoctorLoginPage === 'function') {
      try { window.rerenderDoctorLoginPage(); } catch (e) { console.warn('rerenderDoctorLoginPage', e); }
    }
    function applyDomI18n() {
      if (window.i18n && typeof window.i18n.updatePage === 'function') {
        try { window.i18n.updatePage(); } catch (e) { console.warn('updatePage', e); }
      }
    }
    if (asyncAfter.length) {
      Promise.all(asyncAfter).then(applyDomI18n, applyDomI18n);
    } else {
      applyDomI18n();
    }
  }
  window.rerenderAll = rerenderAll;

  function bindAdminLangButtons() {
    const allowed = new Set(['tr', 'en', 'ru', 'ka']);
    document.querySelectorAll('#alLang .lang-btn, #lang-switcher .lang-btn').forEach(function (btn) {
      if (btn.getAttribute('data-i18n-listener') === '1') return;
      btn.setAttribute('data-i18n-listener', '1');
      function run(e) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        const lang = normalizeAdminLang(
          (e && e.currentTarget && e.currentTarget.getAttribute('data-lang')) || btn.getAttribute('data-lang') || ''
        );
        if (!allowed.has(lang)) return;
        console.log('LANG CLICKED:', lang);
        if (window.AdminI18n && typeof window.AdminI18n.setLanguage === 'function') {
          window.AdminI18n.setLanguage(lang);
        } else if (window.i18n && typeof window.i18n.setLang === 'function') {
          window.i18n.setLang(lang);
        } else if (typeof window.onLanguageChange === 'function') {
          window.onLanguageChange(lang);
        }
        if (window.i18n && typeof window.i18n.getLang === 'function') {
          const cur = window.i18n.getLang();
          console.log('CURRENT LANG:', cur);
          if (cur !== lang) {
            console.warn('Language did not update!');
          }
        }
      }
      btn.addEventListener('click', run);
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          run(e);
        }
      });
    });
  }
  window.rebindAdminLangButtons = bindAdminLangButtons;

  // i18n helper
  const i18n = {
    currentLang: 'en',
    
    init() {
      if (this._i18nInitOnce) {
        return;
      }
      this._i18nInitOnce = true;
      const saved = readAdminLangStorage();
      const lang0 = translations[saved] ? saved : 'en';
      this.currentLang = lang0;
      writeAdminLangStorage(lang0);
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.lang = lang0;
      }
      emitAdminLanguageChanged(lang0, { phase: 'init' });
      this.createLangSwitcher();
      setTimeout(function () {
        clearStaleNavTextNodes();
        emitI18nReady();
        bindAdminLangButtons();
        setTimeout(function () {
          rerenderAll();
        }, 0);
      }, 0);
    },
    
    setLanguage(lang) {
      lang = normalizeAdminLang(lang);
      if (!translations[lang]) lang = 'en';
      this.currentLang = lang;
      writeAdminLangStorage(lang);
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.lang = lang;
      }
      clearStaleNavTextNodes();
      emitAdminLanguageChanged(lang, { phase: 'user' });
      emitI18nReady();
      setTimeout(function () {
        rerenderAll();
        if (window.i18n && typeof window.i18n.getLang === 'function') {
          console.log('FINAL LANG:', window.i18n.getLang());
        }
      }, 0);
      return this;
    },

    setLang(lang) {
      return this.setLanguage(lang);
    },
    
    getLang() {
      return this.currentLang;
    },
    
    t(key, params = {}) {
      const applyParams = (s) => String(s).replace(/\{(\w+)\}/g, (match, p1) => (params[p1] !== undefined ? params[p1] : match));
      const sb = String(key).match(/^dashboard\.sidebar\.(mainMenu|management|logout|clinic)$/);
      if (sb) {
        const node = DASHBOARD_SIDEBAR_I18N[sb[1]];
        if (node && typeof node === 'object') {
          const L = this.currentLang;
          const raw = node[L] != null && node[L] !== '' ? node[L] : (node.en != null && node.en !== '' ? node.en : String(key));
          return applyParams(raw);
        }
      }
      const keys = key.split('.');
      const resolve = (lang) => {
        let value = translations[lang];
        for (const k of keys) {
          if (!value || typeof value !== 'object') return null;
          value = value[k];
        }
        return typeof value === 'string' ? value : null;
      };
      let value = resolve(this.currentLang);
      if (value == null || value === '') value = resolve('en');
      if (value == null || value === '') value = key;
      return applyParams(value);
    },
    
    createLangSwitcher() {
      // Defer to DOMContentLoaded so admin-layout.js has a chance to inject alLang first
      const tryCreate = () => {
        if (document.getElementById('alLang') || document.getElementById('lang-switcher')) return;
        this._doCreateLangSwitcher();
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryCreate);
      } else {
        // Already loaded — wait a tick for admin-layout.js to inject
        setTimeout(tryCreate, 0);
      }
    },
    _doCreateLangSwitcher() {
      if (document.getElementById('alLang') || document.getElementById('lang-switcher')) return;

      const LANGS = [
        { code: 'tr', label: '🇹🇷 TR' },
        { code: 'en', label: '🇬🇧 EN' },
        { code: 'ru', label: '🇷🇺 RU' },
        { code: 'ka', label: '🇬🇪 KA' },
      ];

      const switcher = document.createElement('div');
      switcher.id = 'lang-switcher';
      switcher.className = 'lang-switcher';
      switcher.setAttribute('role', 'group');
      switcher.setAttribute('aria-label', 'Language');
      switcher.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 100000;
        display: flex; gap: 6px;
        background: var(--card, #1f2937); border: 1px solid var(--b, #374151);
        border-radius: 12px; padding: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15); backdrop-filter: blur(10px);
        pointer-events: auto; touch-action: manipulation;
      `;

      const btnStyle = (active) => `
        padding: 6px 12px; border: none; border-radius: 7px;
        background: ${active ? 'var(--p, #2563eb)' : 'transparent'};
        color: ${active ? '#fff' : 'var(--muted, #a7b2c8)'};
        cursor: pointer; font-weight: 600; font-size: 12px; transition: all 0.2s ease;
      `;

      const buttons = {};
      LANGS.forEach(({ code, label }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lang-btn';
        btn.setAttribute('data-lang', code);
        btn.setAttribute('id', 'lang-sel-' + code);
        btn.textContent = label;
        btn.style.cssText = btnStyle(this.currentLang === code);
        buttons[code] = btn;
        switcher.appendChild(btn);
      });

      document.body.appendChild(switcher);

      const updateButtons = () => {
        LANGS.forEach(({ code }) => {
          buttons[code].style.cssText = btnStyle(this.currentLang === code);
        });
      };

      const originalUpdatePage = this.updatePage.bind(this);
      this.updatePage = () => { originalUpdatePage(); updateButtons(); };
      updateButtons();
      bindAdminLangButtons();
    },
    
    updatePage() {
      if (isUpdatingI18n) return;
      isUpdatingI18n = true;
      try {
        // Update all elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach((el) => {
          const key = el.getAttribute('data-i18n');
          let params = {};
          try {
            params = JSON.parse(el.getAttribute('data-i18n-params') || '{}');
          } catch (e) {
            console.error("[i18n] Failed to parse data-i18n-params:", e, { key });
            params = {};
          }
          const translated = this.t(key, params);
          if (/<[a-z][^>]*>/i.test(translated)) {
            el.innerHTML = translated;
          } else {
            el.textContent = translated;
          }
          const text = (el.textContent || '').trim();
          if (text === 'Dashboard' || text === 'Kaydet') {
            console.warn('Hardcoded string detected');
          }
        });
        
        // Update all inputs with data-i18n-placeholder (skip labelled fields — rely on labels only)
        document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
          if (typeof el.closest === "function" && el.closest(".field")) {
            el.removeAttribute("data-i18n-placeholder");
            el.placeholder = "";
            return;
          }
          const key = el.getAttribute("data-i18n-placeholder");
          el.placeholder = this.t(key);
        });
        
        // Update all inputs with data-i18n-title
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
          const key = el.getAttribute('data-i18n-title');
          el.title = this.t(key);
        });
        if (this.currentLang === 'ru' && document.body) {
          const bodyText = document.body.innerText || '';
          if (bodyText.match(/[A-Za-z]/)) {
            console.warn('⚠️ Mixed language detected');
          }
        }
      } finally {
        isUpdatingI18n = false;
      }
    }
  };

  try {
    Object.defineProperty(window, 'i18n', {
      value: i18n,
      configurable: false,
      writable: false,
      enumerable: true
    });
  } catch (e) {
    if (!window.i18n) {
      window.i18n = i18n;
    }
  }
  // Object.freeze(window.i18n) would break setLanguage (mutates currentLang)

  window.applyI18n = function () {
    if (window.i18n && typeof window.i18n.updatePage === 'function') {
      window.i18n.updatePage();
    }
  };

  window.onLanguageChange = function (lang) {
    try {
      if (window.AdminI18n && typeof window.AdminI18n.setLanguage === 'function') {
        window.AdminI18n.setLanguage(lang);
      } else if (window.i18n && typeof window.i18n.setLanguage === 'function') {
        window.i18n.setLanguage(lang);
      }
    } catch (e) {
      console.error("[i18n] window.onLanguageChange failed:", e);
    }
  };

  /**
   * Canonical admin UI language API — all persistence goes through i18n.setLanguage / writeAdminLangStorage.
   * Do not call localStorage.setItem('admin_lang', ...) elsewhere.
   */
  var adminI18nApi = Object.freeze({
    STORAGE_KEY: ADMIN_LANG_STORAGE_KEY,
    /** Dispatched on document after language changes: detail = { lang, phase: 'init'|'user' } */
    LANGUAGE_CHANGED_EVENT: 'admin-language-changed',
    normalizeLanguage: normalizeAdminLang,
    readStored: readAdminLangStorage,
    getLanguage: function () {
      return i18n.getLang();
    },
    setLanguage: function (lang) {
      return i18n.setLanguage(lang);
    },
    /** Before redirect (login → dashboard): align storage + runtime + document.lang. */
    persistFromUi: function () {
      try {
        var norm = normalizeAdminLang(
          (typeof i18n.getLang === 'function' ? i18n.getLang() : '') || readAdminLangStorage() || 'en'
        );
        i18n.setLanguage(norm);
      } catch (e) {
        /* ignore */
      }
    },
    /** After layout inject: apply stored language or refresh data-i18n. */
    syncFromStorage: function () {
      try {
        var stored = readAdminLangStorage();
        if (typeof i18n.getLang === 'function' && i18n.getLang() !== stored) {
          i18n.setLanguage(stored);
        } else if (typeof i18n.updatePage === 'function') {
          i18n.updatePage();
        }
      } catch (e) {
        /* ignore */
      }
    },
  });
  try {
    Object.defineProperty(window, 'AdminI18n', {
      value: adminI18nApi,
      configurable: false,
      writable: false,
      enumerable: true,
    });
  } catch (e) {
    window.AdminI18n = adminI18nApi;
  }

  /** @deprecated Use AdminI18n.persistFromUi */
  window.persistAdminUiLanguage = function () {
    if (window.AdminI18n && typeof window.AdminI18n.persistFromUi === 'function') {
      window.AdminI18n.persistFromUi();
    }
  };

  /** @deprecated Use AdminI18n.syncFromStorage */
  window.syncAdminLanguageFromStorage = function () {
    if (window.AdminI18n && typeof window.AdminI18n.syncFromStorage === 'function') {
      window.AdminI18n.syncFromStorage();
    }
  };

  function assertProcedureNameNotMixed(procedure) {
    if (procedure && typeof procedure.name === "string" && procedure.name.includes("(")) {
      console.warn("Mixed language UI:", procedure.name);
    }
  }
  window.assertProcedureNameNotMixed = assertProcedureNameNotMixed;
  
  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => i18n.init());
  } else {
    i18n.init();
  }
})();
