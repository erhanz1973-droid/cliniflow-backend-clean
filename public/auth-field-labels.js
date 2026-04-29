/**
 * Visible field labels for pages that load /i18n.js but not admin-i18n.js.
 * Use: <label><span data-i18n-label="auth.email"></span></label>, then cliniflowApplyAuthFieldLabels()
 */
(function () {
  "use strict";

  const LABELS = {
    en: {
      "auth.email": "Email",
      "auth.password": "Password",
      "auth.confirm_password": "Confirm password",
      "auth.name": "Full name",
      "patient.phone": "Phone number",
      "patient.clinic_code": "Clinic code",
      "patient.given_name": "First name",
      "patient.family_name": "Last name",
      "patient.referral": "Referral code (optional)",
      "patient.login_help_phone": "Use the phone number registered at your clinic.",
      "patient.login_help_clinic": "The clinic code you were given when you registered.",
      "patient.login_send_code": "Send verification code",
      "patient.login_sending": "Sending…",
      "patient.login_verify": "Verify and sign in",
      "patient.login_verifying": "Verifying…",
      "patient.login_otp_title": "Verify your number",
      "patient.login_otp_label": "Verification code",
      "patient.login_otp_help": "Enter the 6-digit code sent by SMS or email.",
      "patient.login_back": "Edit phone or clinic",
      "patient.login_clinic_mismatch": "That clinic code does not match this account. Check the code and try again.",
      "patient.login_clinic_unlinked": "This account is not linked to a clinic. Contact your clinic.",
      "patient.login_email_missing": "Your clinic must have an email on file for sign-in. Please contact your clinic.",
      "patient.login_err_phone": "Phone number is required.",
      "patient.login_err_clinic": "Clinic code is required.",
      "patient.login_success": "Signed in successfully. Redirecting…",
      "patient.login_err_verify": "Could not complete sign-in.",
      "patient.login_err_otp_format": "Enter the 6-digit code.",
      "patient.super_admin.help_email": "Super admin email",
      "patient.super_admin.help_password": "Super admin password",
      "super_admin.title": "🔐 Super Admin Login",
      "super_admin.subtitle": "System administrator access",
      "super_admin.btn_login": "Log in",
      "super_admin.btn_loading": "Signing in…",
      "super_admin.err_email_required": "Email is required.",
      "super_admin.err_password_required": "Password is required.",
      "super_admin.err_login_failed": "Sign-in failed",
      "super_admin.err_invalid_credentials": "Invalid email or password",
      "super_admin.err_missing_credentials": "Email and password are required",
      "super_admin.err_configuration": "Super admin is not configured",
      "super_admin.err_network": "Connection error:",
      "super_admin.err_unknown": "Unknown error",
      "super_admin.success_redirect": "Signed in successfully. Redirecting…",
    },
    tr: {
      "auth.email": "E-posta",
      "auth.password": "Şifre",
      "auth.confirm_password": "Şifreyi doğrula",
      "auth.name": "Ad soyad",
      "patient.phone": "Telefon numarası",
      "patient.clinic_code": "Klinik kodu",
      "patient.given_name": "Ad",
      "patient.family_name": "Soyad",
      "patient.referral": "Referans kodu (isteğe bağlı)",
      "patient.login_help_phone": "Klinikte kayıtlı telefon numaranızı kullanın.",
      "patient.login_help_clinic": "Kayıt olurken size verilen klinik kodu.",
      "patient.login_send_code": "Doğrulama kodu gönder",
      "patient.login_sending": "Gönderiliyor…",
      "patient.login_verify": "Doğrula ve giriş yap",
      "patient.login_verifying": "Doğrulanıyor…",
      "patient.login_otp_title": "Numaranızı doğrulayın",
      "patient.login_otp_label": "Doğrulama kodu",
      "patient.login_otp_help": "SMS veya e-posta ile gelen 6 haneli kodu girin.",
      "patient.login_back": "Telefon / klinik kodunu düzenle",
      "patient.login_clinic_mismatch": "Bu klinik kodu bu hesapla eşleşmiyor. Kodu kontrol edin.",
      "patient.login_clinic_unlinked": "Bu hesap bir kliniğe bağlı değil. Kliniğinizle iletişime geçin.",
      "patient.login_email_missing": "Giriş için klinikte e-posta kaydı gerekir. Kliniğinize başvurun.",
      "patient.login_err_phone": "Telefon numarası gereklidir.",
      "patient.login_err_clinic": "Klinik kodu gereklidir.",
      "patient.login_success": "Giriş başarılı! Yönlendiriliyorsunuz…",
      "patient.login_err_verify": "Giriş tamamlanamadı.",
      "patient.login_err_otp_format": "6 haneli kodu girin.",
      "patient.super_admin.help_email": "Süper yönetici e-postası",
      "patient.super_admin.help_password": "Süper yönetici şifresi",
      "super_admin.title": "🔐 Süper Yönetici Girişi",
      "super_admin.subtitle": "Sistem yöneticisi erişimi",
      "super_admin.btn_login": "Giriş yap",
      "super_admin.btn_loading": "Giriş yapılıyor…",
      "super_admin.err_email_required": "E-posta gereklidir.",
      "super_admin.err_password_required": "Şifre gereklidir.",
      "super_admin.err_login_failed": "Giriş başarısız",
      "super_admin.err_invalid_credentials": "Geçersiz e-posta veya şifre",
      "super_admin.err_missing_credentials": "E-posta ve şifre gereklidir",
      "super_admin.err_configuration": "Süper yönetici yapılandırılmamış",
      "super_admin.err_network": "Bağlantı hatası:",
      "super_admin.err_unknown": "Bilinmeyen hata",
      "super_admin.success_redirect": "Giriş başarılı! Yönlendiriliyorsunuz…",
    },
    ru: {
      "auth.email": "Эл. почта",
      "auth.password": "Пароль",
      "auth.confirm_password": "Подтвердите пароль",
      "auth.name": "Имя и фамилия",
      "patient.phone": "Номер телефона",
      "patient.clinic_code": "Код клиники",
      "patient.given_name": "Имя",
      "patient.family_name": "Фамилия",
      "patient.referral": "Реферальный код (необязательно)",
      "patient.login_help_phone": "Используйте телефон, указанный в клинике.",
      "patient.login_help_clinic": "Код клиники, который вам дали при регистрации.",
      "patient.login_send_code": "Отправить код",
      "patient.login_sending": "Отправка…",
      "patient.login_verify": "Подтвердить и войти",
      "patient.login_verifying": "Проверка…",
      "patient.login_otp_title": "Подтвердите номер",
      "patient.login_otp_label": "Код подтверждения",
      "patient.login_otp_help": "Введите 6-значный код из SMS или email.",
      "patient.login_back": "Изменить телефон или код клиники",
      "patient.login_clinic_mismatch": "Код клиники не совпадает с этим аккаунтом. Проверьте код.",
      "patient.login_clinic_unlinked": "Аккаунт не привязан к клинике. Свяжитесь с клиникой.",
      "patient.login_email_missing": "Для входа в клинике должен быть указан email. Обратитесь в клинику.",
      "patient.login_err_phone": "Укажите номер телефона.",
      "patient.login_err_clinic": "Укажите код клиники.",
      "patient.login_success": "Вход выполнен. Перенаправление…",
      "patient.login_err_verify": "Не удалось завершить вход.",
      "patient.login_err_otp_format": "Введите 6-значный код.",
      "patient.super_admin.help_email": "Email суперадмина",
      "patient.super_admin.help_password": "Пароль суперадмина",
      "super_admin.title": "🔐 Вход суперадмина",
      "super_admin.subtitle": "Доступ системного администратора",
      "super_admin.btn_login": "Войти",
      "super_admin.btn_loading": "Вход…",
      "super_admin.err_email_required": "Укажите email.",
      "super_admin.err_password_required": "Укажите пароль.",
      "super_admin.err_login_failed": "Не удалось войти",
      "super_admin.err_invalid_credentials": "Неверный email или пароль",
      "super_admin.err_missing_credentials": "Нужны email и пароль",
      "super_admin.err_configuration": "Суперадмин не настроен",
      "super_admin.err_network": "Ошибка подключения:",
      "super_admin.err_unknown": "Неизвестная ошибка",
      "super_admin.success_redirect": "Вход выполнен. Перенаправление…",
    },
    ka: {
      "auth.email": "ელ-ფოსტა",
      "auth.password": "პაროლი",
      "auth.confirm_password": "დაადასტურეთ პაროლი",
      "auth.name": "სახელი და გვარი",
      "patient.phone": "ტელეფონის ნომერი",
      "patient.clinic_code": "კლინიკის კოდი",
      "patient.given_name": "სახელი",
      "patient.family_name": "გვარი",
      "patient.referral": "რეფერალის კოდი (არასავალდებულო)",
      "patient.login_help_phone": "გამოიყენეთ კლინიკაში რეგისტრირებული ტელეფონის ნომერი.",
      "patient.login_help_clinic": "რეგისტრაციისას მიღებული კლინიკის კოდი.",
      "patient.login_send_code": "ვერიფიკაციის კოდის გაგზავნა",
      "patient.login_sending": "იგზავნება…",
      "patient.login_verify": "დადასტურება და შესვლა",
      "patient.login_verifying": "მოწმდება…",
      "patient.login_otp_title": "დაადასტურეთ ნომერი",
      "patient.login_otp_label": "ვერიფიკაციის კოდი",
      "patient.login_otp_help": "შეიყვანეთ 6-ციფრიანი კოდი SMS-იდან ან ელფოსტიდან.",
      "patient.login_back": "ტელეფონი / კლინიკის კოდის ცვლილება",
      "patient.login_clinic_mismatch": "ეს კლინიკის კოდი არ ემთხვევა ამ ანგარიშს. შეამოწმეთ კოდი.",
      "patient.login_clinic_unlinked": "ანგარიში კლინიკასთან არ არის დაკავშირებული. დაუკავშირდით კლინიკას.",
      "patient.login_email_missing": "შესასვლელად საჭიროა ელფოსტა კლინიკაში. მიმართეთ კლინიკას.",
      "patient.login_err_phone": "მიუთითეთ ტელეფონის ნომერი.",
      "patient.login_err_clinic": "მიუთითეთ კლინიკის კოდი.",
      "patient.login_success": "შესვლა წარმატებულია. გადამისამართება…",
      "patient.login_err_verify": "შესვლა ვერ დასრულდა.",
      "patient.login_err_otp_format": "შეიყვანეთ 6-ციფრიანი კოდი.",
      "patient.super_admin.help_email": "სუპერადმინის ელფოსტა",
      "patient.super_admin.help_password": "სუპერადმინის პაროლი",
      "super_admin.title": "🔐 სუპერადმინის შესვლა",
      "super_admin.subtitle": "სისტემური ადმინისტრატორის წვდომა",
      "super_admin.btn_login": "შესვლა",
      "super_admin.btn_loading": "შესვლა…",
      "super_admin.err_email_required": "ელფოსტა სავალდებულოა.",
      "super_admin.err_password_required": "პაროლი სავალდებულოა.",
      "super_admin.err_login_failed": "შესვლა ვერ მოხერხდა",
      "super_admin.err_invalid_credentials": "არასწორი ელფოსტა ან პაროლი",
      "super_admin.err_missing_credentials": "საჭიროა ელფოსტა და პაროლი",
      "super_admin.err_configuration": "სუპერადმინი არ არის კონფიგურირებული",
      "super_admin.err_network": "კავშირის შეცდომა:",
      "super_admin.err_unknown": "უცნობი შეცდომა",
      "super_admin.success_redirect": "შესვლა წარმატებულია. გადამისამართება…",
    },
  };

  function resolveLang() {
    return typeof window.getFindClinicLang === "function"
      ? window.getFindClinicLang()
      : "en";
  }

  window.cliniflowAuthLabel = function (key) {
    var lang = resolveLang();
    var blob = LABELS[lang] || LABELS.en;
    if (key == null) return "";
    var k = String(key);
    return blob[k] ?? LABELS.en[k] ?? k;
  };

  window.cliniflowApplyAuthFieldLabels = function () {
    try {
      var lang = resolveLang();
      var blob = LABELS[lang] || LABELS.en;
      if (typeof document === "undefined" || !document.querySelectorAll) return;
      document.querySelectorAll("[data-i18n-label]").forEach(function (el) {
        var key = el.getAttribute("data-i18n-label");
        if (!key) return;
        var txt = blob[key] ?? LABELS.en[key] ?? key;
        el.textContent = txt;
      });
      document.querySelectorAll("[data-auth-i18n]").forEach(function (el) {
        var key = el.getAttribute("data-auth-i18n");
        if (!key) return;
        var txt = blob[key] ?? LABELS.en[key] ?? key;
        el.textContent = txt;
      });
      try {
        document.documentElement.lang = lang;
      } catch (_e) {
        /* no-op */
      }
    } catch (_e) {
      /* no-op */
    }
  };

  if (typeof document !== "undefined" && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      window.cliniflowApplyAuthFieldLabels();
    });
  } else if (typeof document !== "undefined") {
    try {
      window.cliniflowApplyAuthFieldLabels();
    } catch (_e) {
      /* no-op */
    }
  }
})();
