/**
 * Emit public/locales/{lang}/coordination.js from lib/i18n/messages/*.js
 * Run: node scripts/emit-coordination-locale-browser.cjs
 */
const fs = require("fs");
const path = require("path");

const langs = ["en", "tr", "ru", "ka"];
const root = path.join(__dirname, "..");

for (const lang of langs) {
  const msg = require(path.join(root, "lib/i18n/messages", lang));
  const dir = path.join(root, "public", "locales", lang);
  fs.mkdirSync(dir, { recursive: true });
  const body =
    "window.__cliniflowCoordinationLocales=window.__cliniflowCoordinationLocales||{};" +
    "window.__cliniflowCoordinationLocales." +
    lang +
    "=" +
    JSON.stringify(msg) +
    ";";
  fs.writeFileSync(path.join(dir, "coordination.js"), body);
  console.log("wrote", lang, body.length, "bytes");
}
