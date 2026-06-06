// SetupIntent endpoint — the one-time "save a card" step.
//
// Flow:
//   1. User authenticates (pl_key cookie/header OR Auth0 JWT — same as /api/query).
//   2. Frontend POSTs here.
//   3. We lazily create a Stripe Customer, then mint a SetupIntent and
//      return the client_secret.
//   4. Stripe Elements collects the card client-side and confirms the
//      SetupIntent. Card data never touches our server.
//   5. Stripe fires setup_intent.succeeded → webhook attaches the
//      payment_method_id to the account and sets card_validated_at.
//      That row state is what lib/billing.ts reads before accruing.
//
// No charge happens here. Permission, not payment.

import { authenticateRequest } from "../lib/auth.js";
import { createSetupIntent, ensureStripeCustomer } from "../lib/billing.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await authenticateRequest(
    req.headers["x-pl-key"] as string,
    req.headers["authorization"] as string | undefined,
  );
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }
  const account = auth.account!;

  const customerId = await ensureStripeCustomer({
    accountId: account.id,
    email: account.email,
    existingCustomerId: account.stripe_customer_id,
  });
  if (!customerId) {
    return res.status(500).json({ error: "Could not create Stripe customer" });
  }

  const intent = await createSetupIntent({ customerId });
  if (!intent.ok) {
    return res.status(500).json({ error: intent.error });
  }

  return res.status(200).json({
    ok: true,
    client_secret: intent.client_secret,
    publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
  });
}
