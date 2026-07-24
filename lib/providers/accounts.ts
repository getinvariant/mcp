// Upstream-account inventory (G5).
//
// One provider can be fronted by several API accounts we own — that's how we
// spread load so no single account gets rate-limited or flagged. This resolves
// the set of usable keys for a provider, each with its own rpm limit and weight.
//
// Source of truth, in order:
//   1. Supabase `provider_accounts` (dynamic — add/disable an account without a
//      redeploy). Optional table; absent → step 2.
//   2. Env comma-list `<ENV>` with optional matching `<ENV>_RPM` comma-list.
//
// Keys are addressed downstream by a short stable hash (`id`), never the raw
// secret — so Redis keys and logs never carry an API key.

import { createHash } from "node:crypto";
import { supabase } from "../db.js";

export interface ProviderKey {
  /** Stable, non-secret identifier for this key (hash or DB id). */
  id: string;
  key: string;
  /** This account's sustained limit, requests/minute. */
  rpm: number;
  /** Selection bias — higher means prefer this account. Defaults to rpm. */
  weight: number;
}

const DEFAULT_RPM = Number(process.env.KEY_POOL_DEFAULT_RPM || 60);
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; keys: ProviderKey[] }>();

export function keyId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

/** Synchronous, env-only presence check. Safe to call from provider isAvailable(). */
export function hasEnvKeys(envVar: string): boolean {
  const raw = process.env[envVar];
  return Boolean(raw && raw.split(",").some((k) => k.trim()));
}

function fromEnv(envVar: string): ProviderKey[] {
  const raw = process.env[envVar];
  if (!raw) return [];
  const keys = raw.split(",").map((k) => k.trim()).filter(Boolean);
  const rpmRaw = process.env[`${envVar}_RPM`];
  const rpms = rpmRaw ? rpmRaw.split(",").map((s) => Number(s.trim())) : [];
  return keys.map((key, i) => {
    const rpm = Number.isFinite(rpms[i]) && rpms[i] > 0 ? rpms[i] : DEFAULT_RPM;
    return { id: keyId(key), key, rpm, weight: rpm };
  });
}

/**
 * Resolve usable keys for a provider env var. Memoized for CACHE_TTL_MS so we
 * don't hit Supabase on every upstream call. Never throws — a missing table or
 * a Supabase blip falls back to the env list.
 */
export async function resolveKeys(envVar: string): Promise<ProviderKey[]> {
  const now = Date.now();
  const hit = cache.get(envVar);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.keys;

  let keys = fromEnv(envVar);
  try {
    const { data, error } = await supabase
      .from("provider_accounts")
      .select("id, api_key, rpm_limit, weight, enabled")
      .eq("env_var", envVar)
      .eq("enabled", true);
    if (!error && data && data.length > 0) {
      keys = data.map((r: any) => {
        const rpm = Number(r.rpm_limit) > 0 ? Number(r.rpm_limit) : DEFAULT_RPM;
        return {
          id: r.id != null ? String(r.id) : keyId(r.api_key),
          key: r.api_key,
          rpm,
          weight: Number(r.weight) > 0 ? Number(r.weight) : rpm,
        };
      });
    }
  } catch {
    // table absent or supabase unavailable → env fallback already in `keys`
  }

  cache.set(envVar, { at: now, keys });
  return keys;
}

/** Drop the resolver cache (call after editing provider_accounts). */
export function invalidateKeyCache(envVar?: string): void {
  if (envVar) cache.delete(envVar);
  else cache.clear();
}
