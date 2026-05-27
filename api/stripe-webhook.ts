// Stripe → tier sync.
//
// On checkout.session.completed and customer.subscription.{updated,deleted},
// we look up the account by stripe_customer_id (or email on first link),
// read the active price, map it back to a tier via tiers.ts, and update
// the account's tier + quotas.
//
// Auth0 picks up the new tier on the user's NEXT login via a post-login
// Action that reads `accounts.tier` from Supabase and writes the
// `https://invariant.dev/tier` claim. So this webhook updates DB only —
// Auth0 sees the change ambient, no extra call from here.

import {
  getAccountByStripeCustomer,
  getAccountByEmail,
  updateAccountTier,
} from "../lib/db.js";
import { tierByStripePriceId, tierDefaults } from "../lib/tiers.js";

// Manual signature verification so we don't need the stripe SDK in deps.
// Stripe signs with a comma-separated `Stripe-Signature` header containing
// `t=<timestamp>` and one or more `v1=<sha256>` entries. We verify v1.
import { createHmac, timingSafeEqual } from "node:crypto";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

function verifyStripeSignature(payload: string, sigHeader: string): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn("[stripe] STRIPE_WEBHOOK_SECRET not set — rejecting webhook");
    return false;
  }
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    }),
  );
  const ts = parts.t;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const signedPayload = `${ts}.${payload}`;
  const expected = createHmac("sha256", WEBHOOK_SECRET)
    .update(signedPayload)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Stripe needs the RAW body for signature verification. Vercel parses JSON
  // by default; we read req.rawBody when present, otherwise re-stringify.
  const raw =
    typeof req.rawBody === "string"
      ? req.rawBody
      : Buffer.isBuffer(req.rawBody)
      ? req.rawBody.toString("utf8")
      : JSON.stringify(req.body);

  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig || !verifyStripeSignature(raw, sig)) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  const event = req.body;
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const customerId: string | undefined = session.customer;
        const email: string | undefined = session.customer_details?.email;
        // Initial link: bind stripe_customer_id to the account.
        if (customerId && email) {
          const acct = await getAccountByEmail(email);
          if (acct) {
            await updateAccountTier(acct.id, { stripeCustomerId: customerId });
          }
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const customerId: string = sub.customer;
        const priceId: string | undefined = sub.items?.data?.[0]?.price?.id;
        const tier = tierByStripePriceId(priceId || null);
        const limits = tierDefaults(tier);
        const acct = await getAccountByStripeCustomer(customerId);
        if (acct) {
          await updateAccountTier(acct.id, {
            tier,
            monthlyQuota: limits.monthlyQuota,
            perMinuteRate: limits.perMinuteRate,
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customerId: string = sub.customer;
        const free = tierDefaults("free");
        const acct = await getAccountByStripeCustomer(customerId);
        if (acct) {
          await updateAccountTier(acct.id, {
            tier: "free",
            monthlyQuota: free.monthlyQuota,
            perMinuteRate: free.perMinuteRate,
          });
        }
        break;
      }

      default:
        // ignore — Stripe sends many events we don't care about
        break;
    }
  } catch (err) {
    console.error("[stripe] webhook handler error", err);
    // 200 anyway so Stripe doesn't retry forever on bugs in our code.
    // We log and fix; Stripe's retry would just amplify the same bug.
  }

  return res.status(200).json({ received: true });
}
