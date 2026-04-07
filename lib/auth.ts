const VALID_KEYS = new Set(
  (process.env.PL_VALID_KEYS || "").split(",").filter(Boolean)
);

export function validatePlKey(key: string | undefined): boolean {
  if (!key) return false;
  if (!key.startsWith("pl_")) return false;
  return VALID_KEYS.has(key);
}
