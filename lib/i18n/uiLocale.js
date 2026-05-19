/**
 * Resolve UI locale from HTTP request (admin / doctor / patient apps).
 */

const { normalizeUiLang } = require("./coordinationLocales");

/**
 * @param {import('express').Request} req
 * @returns {'en'|'tr'|'ru'|'ka'}
 */
function uiLangFromRequest(req) {
  const header =
    req?.headers?.["x-ui-language"] ||
    req?.headers?.["x-clinic-ui-language"] ||
    req?.headers?.["accept-language"];
  if (header && typeof header === "string") {
    const first = header.split(",")[0].trim();
    if (first) return normalizeUiLang(first);
  }
  const q = req?.query?.lang || req?.query?.uiLang;
  if (q) return normalizeUiLang(q);
  return "en";
}

module.exports = { uiLangFromRequest, normalizeUiLang };
