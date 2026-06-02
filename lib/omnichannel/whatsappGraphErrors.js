/**
 * Human-readable WhatsApp Graph API errors for admin UI.
 */

const { analyzeWhatsAppScopes } = require("./whatsappGraphDiagnostics");

/**
 * @param {Error|{ message?: string, code?: number|string, type?: string, status?: number }} [err]
 * @param {'tr'|'en'} [lang]
 */
function formatWhatsAppGraphErrorForAdmin(err, lang = "tr") {
  const code = err?.code != null ? Number(err.code) : null;
  const message = String(err?.message || err || "").trim();
  const tr = lang === "tr" || String(lang).startsWith("tr");

  if (code === 100 || /unsupported get request|does not exist|missing permissions/i.test(message)) {
    return {
      code: code || 100,
      short: tr
        ? "Meta phone number ID doğrulanamadı (kod 100)"
        : "Meta phone number ID verification failed (code 100)",
      detail: tr
        ? "Token bu Phone Number ID için yetkili değil, ID yanlış (WABA ID karışmış olabilir) veya farklı Business hesabına ait."
        : "Token lacks access to this phone_number_id, the ID is wrong (WABA vs phone ID), or it belongs to another Business account.",
      steps: tr
        ? [
            "WhatsApp Manager → API setup → Phone number ID kopyalayın (WABA ID değil)",
            "System User token: whatsapp_business_messaging + whatsapp_business_management",
            "Token ile numara aynı Meta Business / WABA altında olmalı",
            "Railway WHATSAPP_ACCESS_TOKEN güncelleyin, admin'de tekrar doğrulayın",
            "Railway loglarında [WHATSAPP_VERIFY] satırına bakın",
          ]
        : [
            "WhatsApp Manager → API setup → copy Phone number ID (not WABA ID)",
            "System User token with whatsapp_business_messaging + whatsapp_business_management",
            "Token and number must be under the same Meta Business / WABA",
            "Update WHATSAPP_ACCESS_TOKEN on Railway and re-verify in admin",
            "Check Railway logs for [WHATSAPP_VERIFY]",
          ],
    };
  }

  if (
    code === 200 ||
    /admin api access blocked/i.test(message) ||
    /whatsapp_business_messaging/i.test(message) ||
    /permission/i.test(message)
  ) {
    return {
      code: code || 200,
      short: tr
        ? "Meta token izni eksik (kod 200)"
        : "Meta token missing permission (code 200)",
      detail: tr
        ? "WhatsApp mesaj göndermek için token’da whatsapp_business_messaging izni olmalı. Eski veya User token çalışmaz."
        : "The access token must include whatsapp_business_messaging. Regenerate a System User token after App Review.",
      steps: tr
        ? [
            "Meta Business Suite → Ayarlar → Kullanıcılar → Sistem kullanıcıları",
            "Yeni token oluştur → whatsapp_business_messaging + whatsapp_business_management seçin",
            "Railway → WHATSAPP_ACCESS_TOKEN değerini bu token ile güncelleyin",
            "Admin → WhatsApp → bağlantıyı yeniden kaydedin veya token’ı güncelleyin",
            "GET /api/integrations/meta/whatsapp/diagnostics ile doğrulayın",
          ]
        : [
            "Meta Business Suite → Settings → Users → System users",
            "Generate new token → select whatsapp_business_messaging + whatsapp_business_management",
            "Update Railway WHATSAPP_ACCESS_TOKEN",
            "Re-save WhatsApp connection in admin if a per-clinic token is stored",
            "Verify via GET /api/integrations/meta/whatsapp/diagnostics",
          ],
    };
  }

  if (code === 131047 || /24.?hour|message window/i.test(message)) {
    return {
      code: code || 131047,
      short: tr ? "24 saat penceresi kapalı" : "24-hour messaging window closed",
      detail: tr
        ? "Hasta son 24 saatte yazmadıysa şablon mesaj gerekir. Önce hastanın size WhatsApp’tan yazmasını sağlayın veya onaylı şablon kullanın."
        : "Use an approved template, or have the patient message your business number first.",
      steps: [],
    };
  }

  if (code === 131026 || /not a valid whatsapp user/i.test(message)) {
    return {
      code: code || 131026,
      short: tr ? "Geçersiz alıcı numarası" : "Invalid recipient",
      detail: tr
        ? "wa_id ülke koduyla, + olmadan (ör. 995514661161). Meta test listesine ekli olmalı (geliştirme modu)."
        : "Use wa_id with country code, no +. Add number to Meta test recipients if app is in Development.",
      steps: [],
    };
  }

  return {
    code,
    short: message || (tr ? "WhatsApp gönderimi başarısız" : "WhatsApp send failed"),
    detail: message,
    steps: [],
  };
}

/**
 * @param {string} token
 */
async function assertWhatsAppTokenCanSend(token) {
  const { debugAccessToken } = require("./metaGraph");
  const debug = await debugAccessToken(String(token || "").trim(), {
    auditLabel: "whatsapp.preflight_send",
  });
  if (!debug?.isValid) {
    return {
      ok: false,
      error: "whatsapp_token_invalid",
      formatted: formatWhatsAppGraphErrorForAdmin({
        message: debug?.error || "invalid_token",
        code: 190,
      }),
      tokenDebug: debug,
    };
  }
  const scope = analyzeWhatsAppScopes(debug?.scopes || []);
  if (!scope.likelyCanSendMessages) {
    return {
      ok: false,
      error: "whatsapp_token_missing_messaging_scope",
      formatted: formatWhatsAppGraphErrorForAdmin({ message: "Admin API access blocked", code: 200 }),
      tokenDebug: { scopes: debug.scopes, ...scope },
    };
  }
  return { ok: true, tokenDebug: debug, scope };
}

module.exports = {
  formatWhatsAppGraphErrorForAdmin,
  assertWhatsAppTokenCanSend,
};
