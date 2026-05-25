/**
 * Encrypt/decrypt Meta Page access tokens at rest (AES-256-GCM).
 */

const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function encryptionKey() {
  const raw = String(process.env.META_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || "").trim();
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

/**
 * @param {string} plaintext
 */
function encryptSecret(plaintext) {
  const key = encryptionKey();
  if (!key) {
    throw new Error("meta_token_encryption_not_configured");
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * @param {string} encoded
 */
function decryptSecret(encoded) {
  const key = encryptionKey();
  if (!key) {
    throw new Error("meta_token_encryption_not_configured");
  }
  const buf = Buffer.from(String(encoded || ""), "base64");
  if (buf.length < IV_LEN + 16 + 1) {
    throw new Error("meta_token_ciphertext_invalid");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

module.exports = {
  encryptSecret,
  decryptSecret,
};
