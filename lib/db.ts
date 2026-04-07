import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

export interface Account {
  id: string;
  pl_key: string;
  email: string | null;
  tier: string;
  monthly_quota: number;
  per_minute_rate: number;
  created_at: string;
}

export async function getAccount(plKey: string): Promise<Account | null> {
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("pl_key", plKey)
    .single();
  if (error || !data) return null;
  return data as Account;
}

export async function logUsage(
  accountId: string,
  providerId: string,
  action: string,
  success: boolean
): Promise<void> {
  const month = new Date().toISOString().slice(0, 7); // '2026-04'

  // fire both in parallel, don't block caller
  await Promise.all([
    supabase.from("usage_log").insert({
      account_id: accountId,
      provider_id: providerId,
      action,
      success,
    }),
    supabase.rpc("increment_monthly_usage", {
      p_account_id: accountId,
      p_provider_id: providerId,
      p_month: month,
    }),
  ]);
}

export async function getAllAccounts(): Promise<Account[]> {
  const { data } = await supabase
    .from("accounts")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as Account[]) || [];
}

export async function createAccount(opts: {
  plKey: string;
  email?: string;
  tier?: string;
  monthlyQuota?: number;
  perMinuteRate?: number;
}): Promise<Account | null> {
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      pl_key: opts.plKey,
      email: opts.email || null,
      tier: opts.tier || "free",
      monthly_quota: opts.monthlyQuota ?? 500,
      per_minute_rate: opts.perMinuteRate ?? 10,
    })
    .select("*")
    .single();
  if (error || !data) return null;
  return data as Account;
}

export async function addToWaitlist(email: string): Promise<boolean> {
  const { error } = await supabase.from("waitlist").insert({ email });
  return !error;
}

export async function getUsage(
  accountId: string,
  month?: string
): Promise<{ provider_id: string; count: number }[]> {
  const m = month || new Date().toISOString().slice(0, 7);
  const { data } = await supabase
    .from("monthly_usage")
    .select("provider_id, count")
    .eq("account_id", accountId)
    .eq("month", m);
  return (data as { provider_id: string; count: number }[]) || [];
}
