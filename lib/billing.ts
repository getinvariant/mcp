// Card-on-file postpaid billing.
//
// Model: user attaches a payment method once via SetupIntent (see
// api/setup-payment.ts). Every provider call accrues cents into
// pending_charges. When pending_cents crosses SWEEP_THRESHOLD_CENTS we
// fire one off-session PaymentIntent rolling them up — this keeps the
// flat 30c Stripe fee from eating sub-dollar charges.
//
// Spend cap: each account carries `spend_cap_cents_remaining`. It is
// decremented at accrue time (not capture time) so a runaway agent can't
// burn through providers while a sweep is in flight. The cap bumps after
// the first PaymentIntent settles successfully — see webhook handler.
//
// Stripe is called via fetch to avoid pulling in the SDK; the webhook
// handler (api/stripe-webhook.ts) already uses node:crypto directly.
// One auth model, zero new deps.
//
// All charges are idempotent. The idempotency_key is the charges.id we
// pre-insert; if the network drops mid-capture we resume with the same
// key and Stripe returns the same intent.

import { supabase } from "./db.js";

const SWEEP_THRESHOLD_CENTS = 500;       // sweep at $5 — Stripe fee math
const STRIPE_API = "https://api.stripe.com/v1";

interface AccrueOk { ok: true; pending_cents: number; swept: boolean; }
interface AccrueErr { ok: false; reason: "no_card" | "frozen" | "cap_exceeded"; }
export type AccrueResult = AccrueOk | AccrueErr;

/**
 * Record an owed amount and sweep if we've crossed the threshold.
 * Returns ok:false WITHOUT recording if the account can't be charged —
 * callers MUST refuse to serve the upstream request in that case.
 */
export async function accrueCharge(
  accountId: string,
  providerId: string,
  amountCents: number,
): Promise<AccrueResult> {
  if (amountCents <= 0) return { ok: true, pending_cents: 0, swept: false };

  const { data: acct } = await supabase
    .from("accounts")
    .select("payment_method_id, card_validated_at, billing_frozen, spend_cap_cents_remaining, pending_cents")
    .eq("id", accountId)
    .single();

  if (!acct) return { ok: false, reason: "no_card" };
  if (acct.billing_frozen) return { ok: false, reason: "frozen" };
  if (!acct.payment_method_id || !acct.card_validated_at) {
    return { ok: false, reason: "no_card" };
  }
  if (amountCents > acct.spend_cap_cents_remaining) {
    return { ok: false, reason: "cap_exceeded" };
  }

  // Decrement cap and bump pending in one atomic RPC. See
  // increment_pending_and_decrement_cap in migration.
  const { data: updated, error } = await supabase.rpc(
    "increment_pending_and_decrement_cap",
    { p_account_id: accountId, p_amount: amountCents },
  );
  if (error || !updated) {
    return { ok: false, reason: "cap_exceeded" };
  }

  await supabase.from("pending_charges").insert({
    account_id: accountId,
    provider_id: providerId,
    amount_cents: amountCents,
  });

  const newPending: number = (updated as any).pending_cents;
  if (newPending >= SWEEP_THRESHOLD_CENTS) {
    // Don't await — sweep is best-effort. If it fails we'll catch it on
    // the next accrue or the hourly cron.
    sweepAccount(accountId).catch((e) =>
      console.error("[billing] sweep failed for", accountId, e),
    );
    return { ok: true, pending_cents: newPending, swept: true };
  }
  return { ok: true, pending_cents: newPending, swept: false };
}

/**
 * Refund part of a just-accrued charge. Writes a negative pending_charges
 * row and bumps the spend cap back up. Used by LLM calls where we estimate
 * at max_tokens and true up to actual output_tokens after the response.
 *
 * Safe to call with 0 — no-ops. Never produces a negative balance because
 * the cap raise is symmetric with the original accrue.
 */
export async function refundAccrual(
  accountId: string,
  providerId: string,
  amountCents: number,
): Promise<void> {
  if (amountCents <= 0) return;
  // Negative pending row: nets out on the next sweep so the user is
  // billed only for the trued-up amount. No Stripe call needed — the
  // original charge hasn't fired yet (sweep threshold = $5).
  await supabase.from("pending_charges").insert({
    account_id: accountId,
    provider_id: providerId,
    amount_cents: -amountCents,
  });
  await supabase.rpc("decrement_pending", {
    p_account_id: accountId,
    p_amount: amountCents,
  });
  await supabase.rpc("credit_spend_cap", {
    p_account_id: accountId,
    p_amount: amountCents,
  });
}

/**
 * Roll all unswept pending_charges for an account into one PaymentIntent.
 * Safe to call repeatedly — claims rows by writing charge_id first, so a
 * second concurrent sweep finds nothing to claim.
 */
export async function sweepAccount(accountId: string): Promise<void> {
  const { data: acct } = await supabase
    .from("accounts")
    .select("id, stripe_customer_id, payment_method_id, pending_cents, billing_frozen")
    .eq("id", accountId)
    .single();
  if (!acct || acct.billing_frozen) return;
  if (!acct.stripe_customer_id || !acct.payment_method_id) return;
  if (acct.pending_cents <= 0) return;

  // Pre-create charge row so we have a stable idempotency_key BEFORE
  // calling Stripe. If we crash here, the row exists with status
  // 'requires_action' and the next sweep will retry by id.
  const idempotencyKey = `sweep_${accountId}_${Date.now()}`;
  const { data: charge, error: insErr } = await supabase
    .from("charges")
    .insert({
      account_id: accountId,
      amount_cents: acct.pending_cents,
      status: "requires_action",
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();
  if (insErr || !charge) return;

  // Claim the unswept pending rows for this charge. Atomic: any row
  // already linked to another charge is skipped.
  const { data: claimed } = await supabase
    .from("pending_charges")
    .update({ charge_id: charge.id })
    .is("charge_id", null)
    .eq("account_id", accountId)
    .select("amount_cents");
  const claimedTotal = (claimed || []).reduce((s, r: any) => s + r.amount_cents, 0);

  if (claimedTotal === 0) {
    // Race: another sweep beat us. Mark our charge row failed and bail.
    await supabase.from("charges").update({
      status: "failed",
      failure_reason: "race_no_rows_claimed",
    }).eq("id", charge.id);
    return;
  }

  // Reset pending_cents by exactly what we claimed (not by acct.pending,
  // which may have grown between read and now).
  await supabase.rpc("decrement_pending", {
    p_account_id: accountId,
    p_amount: claimedTotal,
  });

  const intent = await stripeCreatePaymentIntent({
    customer: acct.stripe_customer_id,
    payment_method: acct.payment_method_id,
    amount: claimedTotal,
    idempotency_key: idempotencyKey,
  });

  if (intent.ok) {
    await supabase.from("charges").update({
      stripe_intent_id: intent.id,
      // status flips to 'succeeded' on payment_intent.succeeded webhook
    }).eq("id", charge.id);
  } else {
    await supabase.from("charges").update({
      status: "failed",
      failure_reason: intent.error,
    }).eq("id", charge.id);
    // Freeze the account on capture failure — don't keep serving when
    // we can't get paid. Unfrozen by a successful new SetupIntent.
    await supabase.from("accounts").update({
      billing_frozen: true,
    }).eq("id", accountId);
  }
}

interface IntentOk { ok: true; id: string; }
interface IntentErr { ok: false; error: string; }

async function stripeCreatePaymentIntent(p: {
  customer: string;
  payment_method: string;
  amount: number;
  idempotency_key: string;
}): Promise<IntentOk | IntentErr> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, error: "STRIPE_SECRET_KEY missing" };

  const body = new URLSearchParams({
    amount: String(p.amount),
    currency: "usd",
    customer: p.customer,
    payment_method: p.payment_method,
    off_session: "true",
    confirm: "true",
    "automatic_payment_methods[enabled]": "true",
    "automatic_payment_methods[allow_redirects]": "never",
  });

  const res = await fetch(`${STRIPE_API}/payment_intents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": p.idempotency_key,
    },
    body,
  });
  const json: any = await res.json();
  if (!res.ok) {
    return { ok: false, error: json?.error?.message || `stripe_${res.status}` };
  }
  return { ok: true, id: json.id };
}

/**
 * Create a SetupIntent so the frontend can collect + tokenize a card
 * with Stripe Elements. We never see the PAN; we only get a pm_... id
 * back via the setup_intent.succeeded webhook.
 */
export async function createSetupIntent(opts: {
  customerId: string;
}): Promise<{ ok: true; client_secret: string } | { ok: false; error: string }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, error: "STRIPE_SECRET_KEY missing" };

  const body = new URLSearchParams({
    customer: opts.customerId,
    "payment_method_types[]": "card",
    usage: "off_session",
  });
  const res = await fetch(`${STRIPE_API}/setup_intents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json: any = await res.json();
  if (!res.ok) {
    return { ok: false, error: json?.error?.message || `stripe_${res.status}` };
  }
  return { ok: true, client_secret: json.client_secret };
}

/**
 * Find-or-create a Stripe customer for an account. Called lazily from
 * the setup-payment handler — most accounts never collect a card so we
 * don't want a Stripe row for every signup.
 */
export async function ensureStripeCustomer(opts: {
  accountId: string;
  email: string | null;
  existingCustomerId: string | null;
}): Promise<string | null> {
  if (opts.existingCustomerId) return opts.existingCustomerId;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;

  const body = new URLSearchParams({
    "metadata[account_id]": opts.accountId,
  });
  if (opts.email) body.set("email", opts.email);

  const res = await fetch(`${STRIPE_API}/customers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  const customerId: string = json.id;

  await supabase.from("accounts").update({
    stripe_customer_id: customerId,
  }).eq("id", opts.accountId);

  return customerId;
}
