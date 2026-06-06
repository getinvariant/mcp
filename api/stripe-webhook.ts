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
  supabase,
} from "../lib/db.js";
import { tierByStripePriceId, tierDefaults } from "../lib/tiers.js";

// After the first successful capture, bump the account's trust cap to
// $50. New accounts start at $2 (see migration default) so a stolen-card
// agent can burn at most $2 of upstream before the first auth fails.
const POST_FIRST_CAPTURE_CAP_CENTS = 5_000;

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

      case "setup_intent.succeeded": {
        // Card collected. Pull the pm_... off the intent, attach to the
        // account, mark validated. This is what unlocks accrueCharge.
        const intent = event.data.object;
        const customerId: string | undefined = intent.customer;
        const paymentMethodId: string | undefined = intent.payment_method;
        if (!customerId || !paymentMethodId) break;
        const acct = await getAccountByStripeCustomer(customerId);
        if (!acct) break;
        await supabase.from("accounts").update({
          payment_method_id: paymentMethodId,
          card_validated_at: new Date().toISOString(),
          billing_frozen: false,        // clear any prior decline freeze
        }).eq("id", acct.id);
        break;
      }

      case "payment_intent.succeeded": {
        // Sweep settled. Flip the charges row, bump trust cap on first win.
        const intent = event.data.object;
        const { data: charge } = await supabase
          .from("charges")
          .select("id, account_id")
          .eq("stripe_intent_id", intent.id)
          .single();
        if (!charge) break;
        await supabase.from("charges").update({
          status: "succeeded",
          settled_at: new Date().toISOString(),
        }).eq("id", charge.id);
        // Idempotent bump: only widen, never shrink. RPC handles the max().
        await supabase.rpc("bump_spend_cap_if_lower", {
          p_account_id: charge.account_id,
          p_new_cap: POST_FIRST_CAPTURE_CAP_CENTS,
        });
        break;
      }

      case "payment_intent.payment_failed": {
        const intent = event.data.object;
        const reason = intent.last_payment_error?.message || "unknown";
        const { data: charge } = await supabase
          .from("charges")
          .select("id, account_id")
          .eq("stripe_intent_id", intent.id)
          .single();
        if (!charge) break;
        await supabase.from("charges").update({
          status: "failed",
          failure_reason: reason,
        }).eq("id", charge.id);
        // Freeze: stop serving until user updates card via a new SetupIntent.
        await supabase.from("accounts").update({
          billing_frozen: true,
        }).eq("id", charge.account_id);
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
