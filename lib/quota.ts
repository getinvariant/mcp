import type { Account } from "./db.js";

export interface QuotaResult {
  ok: boolean;
  remaining: number;
  error?: string;
}

export async function checkAndIncrement(
  _plKey: string,
  _account: Account,
): Promise<QuotaResult> {
  return { ok: true, remaining: Infinity };
}
