"use strict";
const fs = require("fs");
const path = require("path");

const YT = "https://www.youtube.com/@Clinifly";
const OUT = path.join(__dirname, "../public/admin-help-center-i18n.js");

function emitArticle(id, a, indent) {
  const pad = " ".repeat(indent);
  const pad2 = " ".repeat(indent + 2);
  const lines = [pad + '"' + id + '": {'];
  lines.push(pad2 + "title: " + JSON.stringify(a.title) + ",");
  lines.push(pad2 + "what: " + JSON.stringify(a.what) + ",");
  lines.push(pad2 + "why: " + JSON.stringify(a.why) + ",");
  lines.push(pad2 + "how: [");
  a.how.forEach(function (step, i) {
    lines.push(pad2 + "  " + JSON.stringify(step) + (i < a.how.length - 1 ? "," : ""));
  });
  lines.push(pad2 + "],");
  if (a.tips && a.tips.length) {
    lines.push(pad2 + "tips: [");
    a.tips.forEach(function (tip, i) {
      lines.push(pad2 + "  " + JSON.stringify(tip) + (i < a.tips.length - 1 ? "," : ""));
    });
    lines.push(pad2 + "],");
  }
  if (a.linkLabel) {
    lines.push(pad2 + "linkLabel: " + JSON.stringify(a.linkLabel) + ",");
  }
  lines.push(pad + "},");
  return lines.join("\n");
}

function emitPack(pack, indent) {
  const ids = Object.keys(pack);
  const lines = ids.map(function (id) {
    return emitArticle(id, pack[id], indent);
  });
  return lines.join("\n");
}

const ka = require("./help-center-i18n-ka.cjs");
const tr = require("./help-center-i18n-tr.cjs");

const out =
  "/**\n * Help Center article translations — Georgian (ka) and Turkish (tr).\n */\n" +
  "(function (global) {\n" +
  "  global.CliniflyHelpCenterI18n = {\n" +
  "    ka: {\n" +
  emitPack(ka, 6) +
  "\n    },\n" +
  "    tr: {\n" +
  emitPack(tr, 6) +
  "\n    },\n" +
  "  };\n" +
  "})(typeof window !== \"undefined\" ? window : global);\n";

fs.writeFileSync(OUT, out, "utf8");
console.log("Wrote", OUT, "ka:", Object.keys(ka).length, "tr:", Object.keys(tr).length);
