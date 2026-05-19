import { getAccount, type Account } from "./db.js";

export interface AuthResult {
  ok: boolean;
  account?: Account;
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

  return { ok: true, account };
}
