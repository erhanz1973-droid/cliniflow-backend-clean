/**
 * OpenAI API key resolution — supports OPENAI_API_KEY (preferred) and OPENAI_KEY (legacy).
 */

function resolveOpenAiApiKey() {
  return String(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "").trim();
}

function isOpenAiApiKeyConfigured() {
  return Boolean(resolveOpenAiApiKey());
}

/** Which env var supplied the key (for debug logs; never log the key itself). */
function openAiEnvSource() {
  if (String(process.env.OPENAI_API_KEY || "").trim()) return "OPENAI_API_KEY";
  if (String(process.env.OPENAI_KEY || "").trim()) return "OPENAI_KEY";
  return "none";
}

function logOpenAiStartupValidation() {
  const loaded = isOpenAiApiKeyConfigured();
  console.log(
    "[OPENAI_CONFIG]",
    JSON.stringify({
      apiKeyLoaded: loaded,
      keySource: openAiEnvSource(),
    }),
  );
  if (!loaded) {
    console.error("[CONFIG_ERROR] OpenAI API key is missing");
  }
  return loaded;
}

module.exports = {
  resolveOpenAiApiKey,
  isOpenAiApiKeyConfigured,
  openAiEnvSource,
  logOpenAiStartupValidation,
};
