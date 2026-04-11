import { getAccount, type Account } from "./db.js";
import { checkAndIncrement } from "./quota.js";

export interface AuthResult {
  ok: boolean;
  account?: Account;
  remaining?: number;
  error?: string;
  status?: number;
}

export async function authenticateRequest(
  plKey: string | undefined,
): Promise<AuthResult> {
  if (!plKey || !plKey.startsWith("pl_")) {
    return { ok: false, error: "Missing or invalid API key", status: 401 };
  }

  const account = await getAccount(plKey);
  if (!account) {
    return { ok: false, error: "Unknown API key", status: 401 };
  }

  const quota = await checkAndIncrement(plKey, account);
  if (!quota.ok) {
    return {
      ok: false,
      error: quota.error,
      status: 429,
      account,
      remaining: 0,
    };
  }

  return { ok: true, account, remaining: quota.remaining };
}
