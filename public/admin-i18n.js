// Admin Panel i18n System
(function() {
  'use strict';

  // Reentrancy guard to prevent update recursion (stack overflow)
  let isUpdatingI18n = false;

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
        warning: "Uyarı"
      },
      
      // Suspended Clinic Messages
      clinicSuspended: {
        title: "Hesabınız Geçici Olarak Askıya Alındı",
        description: "Klinik hesabınız şu anda aktif değildir. Bu süre boyunca dashboard ve hasta işlemlerine erişim kısıtlanmıştır.",
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
        nav: {
          dashboard: "Dashboard",
          patients: "Hastalar",
          travel: "Seyahat",
          treatment: "Tedaviler",
          schedule: "Takvim",
          doctors: "Doktorlar",
          chat: "Mesajlar",
          files: "Dosyalar",
          referrals: "Referanslar",
          health: "Sağlık",
          settings: "Ayarlar",
          login: "Login",
          register: "Klinik Kaydı"
        },
        sidebar: {
          mainMenu: "Ana Menü",
          management: "Yönetim",
          logout: "Çıkış Yap",
          clinic: "Klinik"
        },
        charts: {
          activePatients: "Aktif Hastalar",
          procedures: "Prosedürler",
          noData: "Veri yok",
          trendNote: "Daha fazla veri toplandıkça trend iyileşecek",
          vsPreviousMonth: "önceki aya göre",
          noPreviousData: "Önceki veri yok",
          summaryActivePatients: "{count} aktif hasta • {month}",
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
        }
      },
      
      // Pricing (pricing.html)
      pricing: {
        title: "Clinifly Fiyatlandırma",
        subtitle: "Aktif hasta sayınıza göre esnek planlar",
        info: "Planlar <span class=\"highlight\">aktif hasta sayısına</span> göre belirlenir. Mevcut hastalarınızla çalışmaya devam edebilirsiniz.",
        free: {
          name: "Free",
          description: "Clinifly'i gerçek hastalarla denemeniz için.",
          cta: "Başla"
        },
        basic: {
          name: "Basic",
          badge: "Popüler",
          description: "Günlük hasta iletişimi olan klinikler için ideal.",
          cta: "Upgrade Et"
        },
        pro: {
          name: "Pro",
          description: "Büyüyen klinikler için limitsiz kullanım.",
          cta: "İletişime Geç"
        },
        features: {
          allCore: "Tüm core özellikler",
          patientCommunication: "Hasta iletişimi",
          fileSharing: "Dosya paylaşımı",
          referral: "Referral sistemi",
          branding: "Clinifly branding",
          customBranding: "Özel branding",
          analytics: "Temel analizler",
          support: "E-posta desteği",
          unlimitedPatients: "Sınırsız hasta",
          advancedReferral: "Gelişmiş referral (level, kampanya)",
          prioritySupport: "Öncelikli destek",
          onboarding: "Özel onboarding"
        },
        comparison: {
          feature: "Özellik",
          free: "Free",
          basic: "Basic",
          pro: "Pro",
          patients: "Aktif Hasta Sayısı",
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
            question: "Aktif hasta sayısı nasıl hesaplanır?",
            answer: "Sadece APPROVED (onaylı) durumundaki hastalar sayılır. Pending, rejected veya cancelled durumundaki hastalar limite dahil edilmez."
          },
          q2: {
            question: "Limit dolduğunda ne olur?",
            answer: "Mevcut hastalarınızla çalışmaya devam edebilirsiniz. Sadece yeni hasta onayı engellenir. Upgrade yaptığınızda işlemlerinize devam edebilirsiniz."
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
        patientName: "Hasta Adı (Seç)",
        selectPatient: "— Hasta seç —",
        patientHelp: "Hasta listesinden Treatment'a basınca otomatik seçilir. Buradan hasta değiştirince otomatik yüklenir.",
        noPatientSelected: "Hasta seçilmedi. Lütfen hasta seçin.",
        loadingTreatments: "Tedaviler yükleniyor...",
        noTreatments: "Bu hasta için tedavi planı bulunamadı.",
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
        patientToothDiagnoses: "Hastanın Diş Tanıları",
        badgeToothDoctor: "Diş No + Doktor Tanısı",
        noDiagnosisSummary: "Tanı kaydı bulunamadı.",
        emptyStateTitle: "Henüz treatment kaydı yok",
        emptyStateSub: "Treatment'lar yüklendiğinde burada görünecek.",
        selectPatientAbove: "Yukarıdan bir hasta seçin.",
        loadingTreatmentsMsg: "Treatments yükleniyor...",
        loadFailed: "Yüklenemedi: {error}",
        noRecordsYet: "Henüz treatment kaydı yok. Diş seçip işlem ekleyebilirsiniz.",
        loadedSummary: "{teethCount} dişte toplam {procCount} işlem yüklendi.",
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
        selToothHintActive: "Dişe tıkla, işlem ekle.",
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
        errors: {
          clinicCodeRequired: "Lütfen klinik kodunu giriniz.",
          passwordRequired: "Lütfen şifrenizi giriniz.",
          invalidCredentials: "Klinik kodu veya şifre hatalı. Lütfen tekrar deneyin.",
          loginFailed: "Giriş başarısız. Lütfen tekrar deneyin.",
          genericError: "Giriş hatası: {error}"
        },
        success: "Hoş geldiniz {name}! Giriş başarılı.",
        sessionExpired: "⏰ Oturum süreniz doldu veya token geçersiz. Lütfen tekrar giriş yapın."
      },
      
      // Register (admin-register.html)
      register: {
        title: "Create Your Clinic",
        subtitle: "Get started in minutes — it's free.",
        clinicCode: "Clinic Code",
        clinicCodeRequired: "*",
        clinicCodePlaceholder: "e.g. MOON, CLINIC01, ISTANBUL",
        clinicCodeHelp: "Bu kod, hastalarınızın gelecekte kliniğinize bağlanmak için kullanacağı koddur.",
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
        goToPatients: "Hasta Listesine Git",
        goToDashboard: "Dashboard'a Git",
        termsText: "Clinifly Dijital Platform Hizmet Sözleşmesi'ni okudum, anladım ve kabul ediyorum. Free Paket kapsamındaki hizmetlerin ücretsiz olduğunu, Free Paket dışındaki dijital hizmetlerin ücretli olduğunu ve bu hizmetlerin kapsam ile bedelinin ayrıca belirleneceğini kabul ederim."
      },
      
      // Settings (admin-settings.html)
      settings: {
        title: "⚙️ Clinic Settings",
        pageTitle: "⚙️ Clinifly Admin – Settings",
        clinicInformation: "Clinic Information",
        brandingNotice: "Branding ayarları yalnızca PRO plan için kullanılabilir.",
        subscriptionPlan: "Abonelik Paketi",
        subscriptionPlanHelp: "FREE / BASIC / PRO paketini buradan değiştirebilirsiniz.",
        plan: "Plan",
        branding: "Branding",
        clinicName: "Clinic Name",
        clinicLogoUrl: "Clinic Logo URL",
        clinicLogoUrlHelp: "Pro plan için logo görüntülenir",
        address: "Clinic Address",
        addressHelp: "Zorunlu (tüm planlar). Yakındaki klinik araması ve konum; adres Google ile geocode edilir.",
        googleMapLink: "Google Maps Link",
        googleMapLinkHelp: "İsteğe bağlı (tüm planlar). Varsa bağlantıdan koordinat alınır; yoksa yalnızca adres kullanılır.",
        welcomeMessage: "Welcome Message",
        primaryColor: "Primary Color (Hex)",
        secondaryColor: "Secondary Color (Hex)",
        referralDiscounts: "🎁 Referral Discounts",
        referralDiscountsHelp: "Configure discount percentages for successful referrals. Both the referrer and the referred patient receive these discounts.",
        referralDiscount: "Referral Discount (%)",
        referralDiscountHelp: "Discount applied to both referrer and referred patient",
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
        temporaryPatientLimit: "🔧 Geçici Hasta Limiti",
        temporaryPatientLimitHelp: "Satış ve onboarding süreçleri için geçici hasta limiti ekleyin. Bu, normal plan limitinin üzerine eklenir.",
        temporaryLimit: "Geçici Limit",
        temporaryLimitPlaceholder: "Ek hasta sayısı (örn: 5)",
        saveTemporaryLimit: "Geçici Limiti Kaydet",
        removeTemporaryLimit: "Geçici Limiti Kaldır",
        temporaryLimitActive: "Mevcut geçici limit: +{count} hasta",
        referralPreviewLabel: "💡 Önizleme:",
        referralPreviewNone: "❌ İndirim uygulanmayacak",
        referralPreviewLow: "✅ <strong>{discount}% indirim</strong> hem davet eden hem de davet edilen hastaya uygulanacak.<br><span style=\"color:#10b981\">💡 Yeni hasta çekmek için harika bir başlangıç!</span>",
        referralPreviewMid: "🎉 <strong>{discount}% indirim</strong> her iki tarafa da uygulanacak.<br><span style=\"color:#f59e0b\">⚠️ Daha yüksek indirim ama daha çekici referanslar!</span>",
        referralPreviewHigh: "🚀 <strong>{discount}% indirim</strong> - Maksimum seviye!<br><span style=\"color:#ef4444\">⚠️ Çok cömert - kârlılığı kontrol edin!</span>",
        save: "💾 Ayarları Kaydet",
        saveLoading: "Kaydediliyor...",
        treatmentPriceList: "💰 Tedavi Fiyat Listesi",
        treatmentPriceListHelp: "Kliniğinizin tedavi fiyatlarını belirleyin. Bu fiyatlar hasta tedavi planları oluşturulurken kullanılacaktır.",
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
          active: "Aktif"
        }
      },

      // Patients (admin-patients.html)
      patients: {
        title: "Clinifly Admin – Patients",
        registeredPatients: "Kayıtlı Hastalar",
        searchPlaceholder: "Ara: isim / telefon / patientId / clinicCode",
        filterAll: "Tümü",
        clearFilters: "Temizle",
        refresh: "Yenile",
        loading: "Yükleniyor...",
        noResults: "Sonuç yok",
        selectedPatient: "Seçili Hasta: {name}",
        patientId: "Patient ID: {id}",
        copyId: "Copy ID",
        copyIdSuccess: "✅ Patient ID kopyalandı",
        clear: "Clear",
        travel: "Seyahat",
        treatment: "Tedavi",
        health: "Sağlık",
        chat: "Chat",
        files: "📁 Dosyalar",
        approve: "Onayla",
        approveConfirm: "Hastayı onaylamak istediğinize emin misiniz? ({patientId})",
        approveSuccess: "✅ Hasta onaylandı",
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
          loadFailed: "❌ Hasta listesi yüklenemedi: {error}",
          approveFailed: "❌ Onaylama hatası: {error}",
          patientLimitReached: "⚠️ Aktif hasta limitinize ulaştınız. Yeni hasta eklemek için planınızı yükseltebilirsiniz.",
          patientLimitReachedTitle: "Hasta Limiti Doldu"
        },
        limits: {
          title: "Aktif Hasta Limiti",
          message: "Mevcut planınızda {current}/{limit} aktif hasta bulunuyor.",
          upgradeMessage: "Yeni hasta eklemek için planınızı yükseltebilirsiniz.",
          upgradeButton: "Planı Yükselt",
          continueButton: "Mevcut Hastalarla Devam Et"
        }
      },
      
      // Referrals (admin-referrals.html)
      referrals: {
        title: "🎁 Clinifly Admin – Referrals",
        referrals: "Referrals",
        filterAll: "Tümü",
        refresh: "Yenile",
        loading: "Yükleniyor...",
        noReferrals: "Referral bulunamadı.",
        inviter: "Inviter",
        invited: "Invited",
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
        pageTitle: "Admin – Hasta Dosyaları",
        title: "📁 Hasta Dosyaları",
        selectPatient: "Hasta:",
        selectPlaceholder: "Hasta seçin...",
        filterAll: "Tümü",
        filterPhoto: "📸 Fotoğraf",
        filterXray: "🦷 Röntgen",
        filterPdf: "📄 PDF",
        filterChat: "💬 Chat",
        upload: "Yükle",
        empty: "Dosya bulunamadı.",
        selectToView: "Dosyaları görmek için hasta seçin.",
        badgeImage: "Fotoğraf",
        badgeXray: "Röntgen",
        badgePdf: "PDF",
        badgeFile: "Dosya",
        badgeChat: "Chat"
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
        warning: "Warning"
      },
      
      // Suspended Clinic Messages
      clinicSuspended: {
        title: "Your Account Has Been Temporarily Suspended",
        description: "Your clinic account is currently inactive. Access to the dashboard and patient features is restricted.",
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
        nav: {
          dashboard: "Dashboard",
          patients: "Patients",
          travel: "Travel",
          treatment: "Treatments",
          schedule: "Calendar",
          doctors: "Doctors",
          chat: "Messages",
          files: "Files",
          referrals: "Referrals",
          health: "Health",
          settings: "Settings",
          login: "Login",
          register: "Register Clinic"
        },
        sidebar: {
          mainMenu: "Main Menu",
          management: "Management",
          logout: "Logout",
          clinic: "Clinic"
        },
        charts: {
          activePatients: "Active Patients",
          procedures: "Procedures",
          noData: "No data",
          trendNote: "Trend will improve as more data is collected",
          vsPreviousMonth: "vs previous month",
          noPreviousData: "No previous data",
          summaryActivePatients: "{count} active patients • {month}",
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
            patients: "patients",
            events: "events"
          }
        }
      },
      
      // Pricing (pricing.html)
      pricing: {
        title: "Clinifly Pricing",
        subtitle: "Flexible plans based on your active patient count",
        info: "Plans are based on <span class=\"highlight\">active patient count</span>. You can continue working with your existing patients.",
        free: {
          name: "Free",
          description: "Try Clinifly with real patients.",
          cta: "Get Started"
        },
        basic: {
          name: "Basic",
          badge: "Popular",
          description: "Ideal for clinics with daily patient communication.",
          cta: "Upgrade"
        },
        pro: {
          name: "Pro",
          description: "Unlimited usage for growing clinics.",
          cta: "Contact Us"
        },
        features: {
          allCore: "All core features",
          patientCommunication: "Patient communication",
          fileSharing: "File sharing",
          referral: "Referral system",
          branding: "Clinifly branding",
          customBranding: "Custom branding",
          analytics: "Basic analytics",
          support: "Email support",
          unlimitedPatients: "Unlimited patients",
          advancedReferral: "Advanced referral (levels, campaigns)",
          prioritySupport: "Priority support",
          onboarding: "Custom onboarding"
        },
        comparison: {
          feature: "Feature",
          free: "Free",
          basic: "Basic",
          pro: "Pro",
          patients: "Active Patients",
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
            question: "How is active patient count calculated?",
            answer: "Only APPROVED (active) patients are counted. Pending, rejected, or cancelled patients are not included in the limit."
          },
          q2: {
            question: "What happens when I reach the limit?",
            answer: "You can continue working with your existing patients. Only new patient approvals are blocked. You can upgrade to continue operations."
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
        patientName: "Patient Name (Select)",
        selectPatient: "— Select patient —",
        patientHelp: "Automatically selected when opening Treatment from the patient list. Changing the patient here reloads data.",
        noPatientSelected: "No patient selected. Please select a patient.",
        loadingTreatments: "Loading treatments...",
        noTreatments: "No treatment plan found for this patient.",
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
        patientToothDiagnoses: "Patient tooth diagnoses",
        badgeToothDoctor: "Tooth No + doctor diagnosis",
        noDiagnosisSummary: "No diagnosis records.",
        emptyStateTitle: "No treatment records yet",
        emptyStateSub: "Treatments will appear here when loaded.",
        selectPatientAbove: "Select a patient above.",
        loadingTreatmentsMsg: "Loading treatments...",
        loadFailed: "Failed to load: {error}",
        noRecordsYet: "No treatment records yet. Select a tooth and add a procedure.",
        loadedSummary: "{teethCount} teeth, {procCount} procedures loaded.",
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
        selToothHintActive: "Click a tooth to add a procedure.",
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
        errors: {
          clinicCodeRequired: "Please enter clinic code.",
          passwordRequired: "Please enter password.",
          invalidCredentials: "Invalid clinic code or password. Please try again.",
          loginFailed: "Login failed. Please try again.",
          genericError: "Login error: {error}"
        },
        success: "Welcome {name}! Login successful.",
        sessionExpired: "⏰ Your session has expired or the token is invalid. Please log in again."
      },
      
      // Register (admin-register.html)
      register: {
        title: "Create Your Clinic",
        subtitle: "Get started in minutes — it's free.",
        clinicCode: "Clinic Code",
        clinicCodeRequired: "*",
        clinicCodePlaceholder: "e.g. MOON, CLINIC01, ISTANBUL",
        clinicCodeHelp: "This code is what your patients will use to connect to your clinic in the future.",
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
        goToPatients: "Go to Patients List",
        goToDashboard: "Go to Dashboard",
        termsText: "I have read, understood and agree to the Clinifly Digital Platform Service Agreement. I acknowledge that services within the Free Package are free of charge, services outside the Free Package are paid, and the scope and price of these services will be determined separately."
      },
      
      // Settings (admin-settings.html)
      settings: {
        title: "⚙️ Clinic Settings",
        pageTitle: "⚙️ Clinifly Admin – Settings",
        clinicInformation: "Clinic Information",
        brandingNotice: "Branding settings are only available for PRO plan.",
        subscriptionPlan: "Subscription Plan",
        subscriptionPlanHelp: "You can change FREE / BASIC / PRO package here.",
        plan: "Plan",
        branding: "Branding",
        referralDiscounts: "🎁 Referral Discounts",
        referralDiscountsHelp: "Configure discount percentages for successful referrals. Both the referrer and the referred patient receive these discounts.",
        referralDiscount: "Referral Discount (%)",
        referralDiscountHelp: "Discount applied to both referrer and referred patient",
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
        referralDiscountHelp: "Discount applied to both referrer and referred patient",
        referralLevel1: "Level 1 (%)",
        referralLevel1Help: "Total discount after 1 successful referral",
        referralLevel2: "Level 2 (%)",
        referralLevel2Help: "Total discount after 2 successful referrals",
        referralLevel3: "Level 3 (%)",
        referralLevel3Help: "Maximum discount for 3+ referrals",
        temporaryPatientLimit: "🔧 Temporary Patient Limit",
        temporaryPatientLimitHelp: "Add temporary patient limit for sales and onboarding processes. This is added on top of the normal plan limit.",
        temporaryLimit: "Temporary Limit",
        temporaryLimitPlaceholder: "Additional patients (e.g., 5)",
        saveTemporaryLimit: "Save Temporary Limit",
        removeTemporaryLimit: "Remove Temporary Limit",
        temporaryLimitActive: "Current temporary limit: +{count} patients",
        referralPreviewLabel: "💡 Preview:",
        referralPreviewNone: "❌ No discount will be applied",
        referralPreviewLow: "✅ <strong>{discount}% discount</strong> will be applied to both referrer and referred patient.<br><span style=\"color:#10b981\">💡 Great starting point for attracting new patients!</span>",
        referralPreviewMid: "🎉 <strong>{discount}% discount</strong> for both parties.<br><span style=\"color:#f59e0b\">⚠️ Higher discount but more attractive referrals!</span>",
        referralPreviewHigh: "🚀 <strong>{discount}% discount</strong> - Maximum level!<br><span style=\"color:#ef4444\">⚠️ Very generous - ensure profitability!</span>",
        save: "💾 Save Settings",
        saveLoading: "Saving...",
        treatmentPriceList: "💰 Treatment Price List",
        treatmentPriceListHelp: "Define your clinic's treatment prices. These prices will be used when creating patient treatment plans.",
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
          active: "Active"
        }
      },

      // Patients (admin-patients.html)
      patients: {
        title: "Clinifly Admin – Patients",
        registeredPatients: "Registered Patients",
        searchPlaceholder: "Search: name / phone / patientId / clinicCode",
        filterAll: "All",
        clearFilters: "Clear",
        refresh: "Refresh",
        loading: "Loading...",
        noResults: "No results",
        selectedPatient: "Selected Patient: {name}",
        patientId: "Patient ID: {id}",
        copyId: "Copy ID",
        copyIdSuccess: "✅ Patient ID copied",
        clear: "Clear",
        travel: "Travel",
        treatment: "Treatment",
        health: "Health",
        chat: "Chat",
        files: "📁 Files",
        approve: "Approve",
        approveConfirm: "Are you sure you want to approve this patient? ({patientId})",
        approveSuccess: "✅ Patient approved",
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
          loadFailed: "❌ Failed to load patient list: {error}",
          approveFailed: "❌ Approval error: {error}",
          patientLimitReached: "⚠️ You've reached your active patient limit. Upgrade your plan to add new patients.",
          patientLimitReachedTitle: "Patient Limit Reached"
        },
        limits: {
          title: "Active Patient Limit",
          message: "Your current plan has {current}/{limit} active patients.",
          upgradeMessage: "Upgrade your plan to add new patients.",
          upgradeButton: "Upgrade Plan",
          continueButton: "Continue with Existing Patients"
        }
      },
      
      // Referrals (admin-referrals.html)
      referrals: {
        title: "🎁 Clinifly Admin – Referrals",
        referrals: "Referrals",
        filterAll: "All",
        refresh: "Refresh",
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
        pageTitle: "Admin – Patient Files",
        title: "📁 Patient Files",
        selectPatient: "Patient:",
        selectPlaceholder: "Select patient...",
        filterAll: "All",
        filterPhoto: "📸 Photos",
        filterXray: "🦷 X-Rays",
        filterPdf: "📄 PDF",
        filterChat: "💬 Chat",
        upload: "Upload",
        empty: "No files found.",
        selectToView: "Select a patient to view their files.",
        badgeImage: "Photo",
        badgeXray: "X-Ray",
        badgePdf: "PDF",
        badgeFile: "File",
        badgeChat: "Chat"
      }
    },

    ru: {
      common: {
        loading: "Загрузка...", save: "Сохранить", cancel: "Отмена", delete: "Удалить",
        edit: "Редактировать", search: "Поиск", filter: "Фильтр", close: "Закрыть",
        back: "Назад", next: "Далее", previous: "Предыдущий", submit: "Отправить",
        yes: "Да", no: "Нет", ok: "ОК", error: "Ошибка", success: "Успешно", warning: "Предупреждение"
      },
      dashboard: {
        title: "Clinifly Admin – Панель управления",
        nav: { dashboard: "Панель", patients: "Пациенты", travel: "Путешествие", treatment: "Лечение", schedule: "Календарь", doctors: "Врачи", chat: "Сообщения", files: "Файлы", referrals: "Рефералы", health: "Здоровье", settings: "Настройки" },
        sidebar: { mainMenu: "Главное меню", management: "Управление", logout: "Выйти", clinic: "Клиника" },
        charts: {
          activePatients: "Активные пациенты",
          procedures: "Процедуры",
          noData: "Нет данных",
          trendNote: "Тренд улучшится по мере накопления данных",
          vsPreviousMonth: "по сравнению с прошлым месяцем",
          noPreviousData: "Нет данных за предыдущий период",
          summaryActivePatients: "{count} активных пациентов • {month}",
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
        }
      },
      login: { title: "Вход в Clinifly Admin", clinicCode: "Код клиники", password: "Пароль", login: "Войти", loading: "Загрузка...", error: "Ошибка входа", invalidCredentials: "Неверный код клиники или пароль.", sessionExpired: "⏰ Срок сессии истёк или токен недействителен. Пожалуйста, войдите снова." },
      patients: {
        title: "Пациенты", search: "Поиск пациентов...", filter: "Фильтр",
        filterAll: "Все", approve: "Одобрить", treatment: "Лечение", chat: "Чат", travel: "Путешествие", health: "Здоровье", files: "📁 Файлы",
        approveConfirm: "Вы хотите одобрить пациента? ({patientId})", approveSuccess: "✅ Пациент одобрен",
        before: "До", after: "После", phone: "Телефон",
        status: { PENDING: "Ожидание", APPROVED: "Одобрено" },
        errors: { noToken: "⚠️ Токен не найден.", loadFailed: "❌ Ошибка загрузки: {error}", approveFailed: "❌ Ошибка одобрения: {error}" }
      },
      referrals: {
        title: "🎁 Рефералы", referrals: "Рефералы", filterAll: "Все", refresh: "Обновить",
        loading: "Загрузка...", noReferrals: "Рефералы не найдены.",
        inviter: "Пригласивший", invited: "Приглашённый", createdAt: "Создано",
        inviterDiscount: "Скидка пригласившего", invitedDiscount: "Скидка приглашённого", discount: "Скидка",
        approve: "Одобрить", reject: "Отклонить",
        approveConfirm: "Вы уверены, что хотите одобрить?", rejectConfirm: "Вы уверены, что хотите отклонить?",
        approved: "Реферал одобрен ✅", rejected: "Реферал отклонён ✅",
        status: { PENDING: "Ожидание", APPROVED: "Одобрено", REJECTED: "Отклонено" },
        errors: { noToken: "⚠️ Токен не найден.", loadFailed: "Ошибка загрузки.", approveFailed: "Ошибка: {error}", rejectFailed: "Ошибка: {error}" }
      },
      settings: {
        title: "⚙️ Настройки клиники",
        pageTitle: "⚙️ Clinifly Admin – Настройки",
        clinicInformation: "Информация о клинике",
        brandingNotice: "Настройки брендинга доступны только для плана PRO.",
        subscriptionPlan: "Тарифный план",
        subscriptionPlanHelp: "Здесь вы можете изменить план FREE / BASIC / PRO.",
        plan: "План",
        branding: "Брендинг",
        clinicName: "Название клиники",
        clinicLogoUrl: "URL логотипа клиники",
        clinicLogoUrlHelp: "Логотип отображается для плана Pro",
        address: "Адрес клиники",
        addressHelp: "Отображается на экране пациента для плана Pro",
        googleMapLink: "Ссылка Google Maps",
        googleMapLinkHelp: "Отображается на экране пациента для плана Pro",
        primaryColor: "Основной цвет (Hex)",
        secondaryColor: "Дополнительный цвет (Hex)",
        welcomeMessage: "Приветственное сообщение",
        referralDiscounts: "🎁 Реферальные скидки",
        referralDiscountsHelp: "Настройте процентные скидки для успешных рефералов.",
        referralDiscount: "Реферальная скидка (%)",
        referralDiscountHelp: "Скидка для пригласившего и приглашённого",
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
        temporaryPatientLimit: "🔧 Временный лимит пациентов",
        temporaryPatientLimitHelp: "Добавьте временный лимит для процессов продаж. Добавляется поверх обычного лимита плана.",
        temporaryLimit: "Временный лимит",
        temporaryLimitPlaceholder: "Доп. кол-во пациентов (напр.: 5)",
        saveTemporaryLimit: "Сохранить временный лимит",
        removeTemporaryLimit: "Удалить временный лимит",
        temporaryLimitActive: "Текущий временный лимит: +{count} пациентов",
        referralPreviewLabel: "💡 Предпросмотр:",
        referralPreviewNone: "❌ Скидка применяться не будет",
        referralPreviewLow: "✅ <strong>Скидка {discount}%</strong> будет применена как пригласившему, так и приглашённому.<br><span style=\"color:#10b981\">💡 Отличная отправная точка для привлечения новых пациентов!</span>",
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
          active: "Активно"
        }
      },
      treatment: {
        patientName: "Имя пациента (выбор)",
        selectPatient: "— Выберите пациента —",
        patientHelp: "Автоматически подставляется при открытии из списка пациентов. Смена пациента перезагружает данные.",
        noPatientSelected: "Пациент не выбран.",
        loadingTreatments: "Загрузка планов лечения...",
        noTreatments: "План лечения для этого пациента не найден.",
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
        patientToothDiagnoses: "Диагнозы по зубам пациента",
        badgeToothDoctor: "Зуб № + диагноз врача",
        noDiagnosisSummary: "Записей диагнозов нет.",
        emptyStateTitle: "Записей лечения пока нет",
        emptyStateSub: "Данные появятся после загрузки.",
        selectPatientAbove: "Выберите пациента выше.",
        loadingTreatmentsMsg: "Загрузка лечения...",
        loadFailed: "Не удалось загрузить: {error}",
        noRecordsYet: "Записей нет. Выберите зуб и добавьте процедуру.",
        loadedSummary: "{teethCount} зубов, процедур: {procCount}.",
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
        pageTitle: "Admin – Файлы пациента",
        title: "📁 Файлы пациента",
        selectPatient: "Пациент:",
        selectPlaceholder: "Выберите пациента...",
        filterAll: "Все",
        filterPhoto: "📸 Фото",
        filterXray: "🦷 Рентген",
        filterPdf: "📄 PDF",
        filterChat: "💬 Чат",
        upload: "Загрузить",
        empty: "Файлы не найдены.",
        selectToView: "Выберите пациента для просмотра файлов.",
        badgeImage: "Фото",
        badgeXray: "Рентген",
        badgePdf: "PDF",
        badgeFile: "Файл",
        badgeChat: "Чат"
      }
    },

    ka: {
      common: {
        loading: "იტვირთება...", save: "შენახვა", cancel: "გაუქმება", delete: "წაშლა",
        edit: "რედაქტირება", search: "ძებნა", filter: "ფილტრი", close: "დახურვა",
        back: "უკან", next: "შემდეგ", previous: "წინა", submit: "გაგზავნა",
        yes: "დიახ", no: "არა", ok: "OK", error: "შეცდომა", success: "წარმატება", warning: "გაფრთხილება"
      },
      dashboard: {
        title: "Clinifly Admin – მართვის პანელი",
        nav: { dashboard: "პანელი", patients: "პაციენტები", travel: "მოგზაურობა", treatment: "მკურნალება", schedule: "კალენდარი", doctors: "ექიმები", chat: "შეტყობინებები", files: "ფაილები", referrals: "მოწვევები", health: "ჯანმრთელობა", settings: "პარამეტრები" },
        sidebar: { mainMenu: "მთავარი მენიუ", management: "მართვა", logout: "გასვლა", clinic: "კლინიკა" },
        charts: {
          activePatients: "აქტიური პაციენტები",
          procedures: "პროცედურები",
          noData: "მონაცემი არ არის",
          trendNote: "ტრენდი გაუმჯობესდება მეტი მონაცემის დაგროვებისას",
          vsPreviousMonth: "წინა თვესთან შედარებით",
          noPreviousData: "წინა მონაცემი არ არის",
          summaryActivePatients: "{count} აქტიური პაციენტი • {month}",
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
        }
      },
      login: { title: "Clinifly Admin-ში შესვლა", clinicCode: "კლინიკის კოდი", password: "პაროლი", login: "შესვლა", loading: "იტვირთება...", error: "შესვლის შეცდომა", invalidCredentials: "კლინიკის კოდი ან პაროლი არასწორია.", sessionExpired: "⏰ სეანსი ამოიწურა ან ტოკენი არასწორია. გთხოვთ, ხელახლა შეხვიდეთ." },
      patients: {
        title: "პაციენტები", search: "პაციენტის ძებნა...", filter: "ფილტრი",
        filterAll: "ყველა", approve: "დადასტურება", treatment: "მკურნალება", chat: "ჩათი", travel: "მოგზაურობა", health: "ჯანმრთელობა", files: "📁 ფაილები",
        approveConfirm: "გსურთ პაციენტის დადასტურება? ({patientId})", approveSuccess: "✅ პაციენტი დადასტურებულია",
        before: "წინ", after: "შემდეგ", phone: "ტელეფონი",
        status: { PENDING: "მოლოდინში", APPROVED: "დადასტურებულია" },
        errors: { noToken: "⚠️ ტოკენი ვერ მოიძებნა.", loadFailed: "❌ ჩატვირთვის შეცდომა: {error}", approveFailed: "❌ დადასტურების შეცდომა: {error}" }
      },
      referrals: {
        title: "🎁 მოწვევები", referrals: "მოწვევები", filterAll: "ყველა", refresh: "განახლება",
        loading: "იტვირთება...", noReferrals: "მოწვევები ვერ მოიძებნა.",
        inviter: "მოწვეული", invited: "მოპატიჟებული", createdAt: "შეიქმნა",
        inviterDiscount: "მოწვეულის ფასდაკლება", invitedDiscount: "მოპატიჟებულის ფასდაკლება", discount: "ფასდაკლება",
        approve: "დადასტურება", reject: "უარყოფა",
        approveConfirm: "დარწმუნებული ხართ?", rejectConfirm: "დარწმუნებული ხართ?",
        approved: "მოწვევა დადასტურებულია ✅", rejected: "მოწვევა უარყოფილია ✅",
        status: { PENDING: "მოლოდინში", APPROVED: "დადასტურებულია", REJECTED: "უარყოფილია" },
        errors: { noToken: "⚠️ ტოკენი ვერ მოიძებნა.", loadFailed: "ჩატვირთვის შეცდომა.", approveFailed: "შეცდომა: {error}", rejectFailed: "შეცდომა: {error}" }
      },
      settings: {
        title: "⚙️ კლინიკის პარამეტრები",
        pageTitle: "⚙️ Clinifly Admin – პარამეტრები",
        clinicInformation: "კლინიკის ინფორმაცია",
        brandingNotice: "ბრენდინგის პარამეტრები ხელმისაწვდომია მხოლოდ PRO გეგმისთვის.",
        subscriptionPlan: "სააბონემენტო გეგმა",
        subscriptionPlanHelp: "შეგიძლიათ შეცვალოთ FREE / BASIC / PRO პაკეტი.",
        plan: "გეგმა",
        branding: "ბრენდინგი",
        clinicName: "კლინიკის სახელი",
        clinicLogoUrl: "კლინიკის ლოგოს URL",
        clinicLogoUrlHelp: "ლოგო ნაჩვენებია Pro გეგმისთვის",
        address: "კლინიკის მისამართი",
        addressHelp: "ნაჩვენებია პაციენტის ეკრანზე Pro გეგმისთვის",
        googleMapLink: "Google Maps ბმული",
        googleMapLinkHelp: "ნაჩვენებია პაციენტის ეკრანზე Pro გეგმისთვის",
        primaryColor: "ძირითადი ფერი (Hex)",
        secondaryColor: "მეორადი ფერი (Hex)",
        welcomeMessage: "მისასალმებელი შეტყობინება",
        referralDiscounts: "🎁 მოწვევის ფასდაკლებები",
        referralDiscountsHelp: "დააყენეთ ფასდაკლების პროცენტები წარმატებული მოწვევებისთვის.",
        referralDiscount: "მოწვევის ფასდაკლება (%)",
        referralDiscountHelp: "ფასდაკლება მიეწოდება ორივეს: მოწვეულსა და მოპატიჟებულს",
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
        temporaryPatientLimit: "🔧 დროებითი პაციენტის ლიმიტი",
        temporaryPatientLimitHelp: "დაამატეთ დროებითი ლიმიტი გაყიდვების პროცესისთვის.",
        temporaryLimit: "დროებითი ლიმიტი",
        temporaryLimitPlaceholder: "დამატებითი პაციენტები (მაგ.: 5)",
        saveTemporaryLimit: "დროებითი ლიმიტის შენახვა",
        removeTemporaryLimit: "დროებითი ლიმიტის წაშლა",
        temporaryLimitActive: "მიმდინარე დროებითი ლიმიტი: +{count} პაციენტი",
        referralPreviewLabel: "💡 გადახედვა:",
        referralPreviewNone: "❌ ფასდაკლება არ გამოიყენება",
        referralPreviewLow: "✅ <strong>{discount}% ფასდაკლება</strong> გამოიყენება როგორც მოწვეულისთვის, ასევე მოპატიჟებულისთვის.<br><span style=\"color:#10b981\">💡 შესანიშნავი დასაწყისი ახალი პაციენტების მოსაზიდად!</span>",
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
          active: "აქტიური"
        }
      },
      treatment: {
        patientName: "პაციენტის სახელი (არჩევა)",
        selectPatient: "— აირჩიეთ პაციენტი —",
        patientHelp: "ავტომატურად ივსება პაციენტების სიიდან. პაციენტის შეცვლა ხელახლა ტვირთავს მონაცემებს.",
        noPatientSelected: "პაციენტი არ არის არჩეული.",
        loadingTreatments: "მკურნალობის გეგმის ჩატვირთვა...",
        noTreatments: "ამ პაციენტისთვის გეგმა ვერ მოიძებნა.",
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
        patientToothDiagnoses: "პაციენტის კბილის დიაგნოზები",
        badgeToothDoctor: "კბილი № + ექიმის დიაგნოზი",
        noDiagnosisSummary: "დიაგნოზის ჩანაწერი არ არის.",
        emptyStateTitle: "ჩანაწერი ჯერ არ არის",
        emptyStateSub: "მონაცემები გამოჩნდება ჩატვირთვის შემდეგ.",
        selectPatientAbove: "ზემოთ აირჩიეთ პაციენტი.",
        loadingTreatmentsMsg: "იტვირთება...",
        loadFailed: "ჩატვირთვა ვერ მოხერხდა: {error}",
        noRecordsYet: "ჩანაწერი არ არის. აირჩიეთ კბილი და დაამატეთ პროცედურა.",
        loadedSummary: "{teethCount} კბილი, პროცედურა: {procCount}.",
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
        pageTitle: "Admin – პაციენტის ფაილები",
        title: "📁 პაციენტის ფაილები",
        selectPatient: "პაციენტი:",
        selectPlaceholder: "პაციენტი აირჩიეთ...",
        filterAll: "ყველა",
        filterPhoto: "📸 ფოტო",
        filterXray: "🦷 რენტგენი",
        filterPdf: "📄 PDF",
        filterChat: "💬 ჩათი",
        upload: "ატვირთვა",
        empty: "ფაილები ვერ მოიძებნა.",
        selectToView: "ფაილების სანახავად პაციენტი აირჩიეთ.",
        badgeImage: "ფოტო",
        badgeXray: "რენტგენი",
        badgePdf: "PDF",
        badgeFile: "ფაილი",
        badgeChat: "ჩათი"
      }
    }
  };

  // i18n helper
  const i18n = {
    currentLang: 'tr',
    
    init() {
      // Load saved language or default to Turkish
      const saved = localStorage.getItem('admin_lang') || 'tr';
      this.setLanguage(saved);
      this.createLangSwitcher();
      // Render static translations once on init
      this.updatePage();
      // Notify page-level hook once, if present
      if (typeof window.onI18nUpdated === 'function') {
        try {
          window.onI18nUpdated(this.currentLang);
        } catch (e) {
          console.error("[i18n] onI18nUpdated hook failed during init:", e);
        }
      }
    },
    
    // State-only: do NOT call updatePage() here.
    setLanguage(lang) {
      if (!translations[lang]) lang = 'en';
      this.currentLang = lang;
      localStorage.setItem('admin_lang', lang);
      document.documentElement.lang = lang;
    },

    // Backward-compatible alias
    setLang(lang) {
      return this.setLanguage(lang);
    },
    
    getLang() {
      return this.currentLang;
    },
    
    t(key, params = {}) {
      const keys = key.split('.');
      const resolve = (lang) => {
        let value = translations[lang];
        for (const k of keys) {
          if (!value || typeof value !== 'object') return null;
          value = value[k];
        }
        return typeof value === 'string' ? value : null;
      };
      const value = resolve(this.currentLang) || resolve('en') || key;
      return value.replace(/\{(\w+)\}/g, (match, p1) => {
        return params[p1] !== undefined ? params[p1] : match;
      });
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
      switcher.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 1000;
        display: flex; gap: 6px;
        background: var(--card, #1f2937); border: 1px solid var(--b, #374151);
        border-radius: 12px; padding: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15); backdrop-filter: blur(10px);
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
        btn.textContent = label;
        btn.style.cssText = btnStyle(this.currentLang === code);
        btn.onclick = () => {
          if (typeof window.onLanguageChange === 'function') window.onLanguageChange(code);
          else { this.setLanguage(code); this.updatePage(); }
        };
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
    },
    
    updatePage() {
      if (isUpdatingI18n) return;
      isUpdatingI18n = true;
      try {
        // Update all elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(el => {
          const key = el.getAttribute('data-i18n');
          let params = {};
          try {
            params = JSON.parse(el.getAttribute('data-i18n-params') || '{}');
          } catch (e) {
            console.error("[i18n] Failed to parse data-i18n-params:", e, { key });
            params = {};
          }
          el.textContent = this.t(key, params);
        });
        
        // Update all inputs with data-i18n-placeholder
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
          const key = el.getAttribute('data-i18n-placeholder');
          el.placeholder = this.t(key);
        });
        
        // Update all inputs with data-i18n-title
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
          const key = el.getAttribute('data-i18n-title');
          el.title = this.t(key);
        });
      } finally {
        isUpdatingI18n = false;
      }
    }
  };

  // Make i18n globally available
  window.i18n = i18n;

  // Global language change entrypoint (single direction; no recursion)
  // - Only changes language state and triggers a DOM refresh
  // - Pages can optionally implement window.onI18nUpdated(lang) for dynamic re-renders
  window.onLanguageChange = function(lang) {
    try {
      window.i18n.setLanguage(lang);
      window.i18n.updatePage();
      if (typeof window.onI18nUpdated === 'function') {
        window.onI18nUpdated(lang);
      }
    } catch (e) {
      console.error("[i18n] window.onLanguageChange failed:", e);
    }
  };
  
  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => i18n.init());
  } else {
    i18n.init();
  }
})();
