// Subscription tier policy — the single source of truth for what each tier
// allows. Stripe webhooks + Auth0 Actions both consult this when syncing
// `accounts.tier` and the `https://invariant.dev/tier` JWT claim.
//
// IMPORTANT: numbers here drive billing and user expectations. They should
// match what the marketing site advertises. See the TIER_DEFAULTS table below
// — change one place, propagates everywhere.

export type Tier = "free" | "starter" | "pro" | "scale";

export interface TierLimits {
  /** Total successful provider calls allowed per calendar month. */
  monthlyQuota: number;
  /** Max provider calls per minute (per-account rate limit). */
  perMinuteRate: number;
  /** Stripe price ID this tier maps to (null for free). */
  stripePriceId: string | null;
  /** Display label for billing pages + emails. */
  displayName: string;
}

/**
 * Defaults shipped with the codebase. These can be overridden per-account by
 * setting accounts.monthly_quota / per_minute_rate directly (useful for
 * grandfathering early users or comping power users).
 */
const TIER_DEFAULTS: Record<Tier, TierLimits> = {
  free: {
    monthlyQuota: 500,
    perMinuteRate: 10,
    stripePriceId: null,
    displayName: "Free",
  },
  starter: {
    monthlyQuota: 10_000,
    perMinuteRate: 60,
    stripePriceId: process.env.STRIPE_PRICE_STARTER || null,
    displayName: "Starter",
  },
  pro: {
    monthlyQuota: 100_000,
    perMinuteRate: 300,
    stripePriceId: process.env.STRIPE_PRICE_PRO || null,
    displayName: "Pro",
  },
  scale: {
    monthlyQuota: 1_000_000,
    perMinuteRate: 1_000,
    stripePriceId: process.env.STRIPE_PRICE_SCALE || null,
    displayName: "Scale",
  },
};

export function tierDefaults(tier: string): TierLimits {
  return TIER_DEFAULTS[tier as Tier] ?? TIER_DEFAULTS.free;
}

export function tierByStripePriceId(priceId: string | null): Tier {
  if (!priceId) return "free";
  for (const [tier, limits] of Object.entries(TIER_DEFAULTS)) {
    if (limits.stripePriceId === priceId) return tier as Tier;
  }
  return "free";
}

export function allTiers(): Array<{ tier: Tier; limits: TierLimits }> {
  return (Object.keys(TIER_DEFAULTS) as Tier[]).map((tier) => ({
    tier,
    limits: TIER_DEFAULTS[tier],
  }));
}
