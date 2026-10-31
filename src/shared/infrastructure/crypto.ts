import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const key = (): Buffer =>
  createHash("sha256")
    .update(
      process.env.PROVIDER_SECRET_ENCRYPTION_KEY ??
        "development-secret-change-me",
    )
    .digest();
export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
export const hmac256 = (secret: string, value: string): string =>
  createHmac("sha256", secret).update(value).digest("hex");
export const constantTimeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
};
export const encrypt = (value: string): Buffer => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
};
export const decrypt = (payload: Buffer): string => {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    payload.subarray(0, 12),
  );
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([
    decipher.update(payload.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
};
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(sortValue(value));
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortValue(v)]),
    );
  return value;
}
