// x402 settlement — the agent→Invariant payment leg.
//
// When X402_ENABLED, paid /api/query calls are gated behind a real Base Sepolia
// USDC payment. The agent gets an HTTP 402 with PaymentRequirements, signs an
// EIP-3009 transferWithAuthorization (gasless for it), and retries with an
// X-PAYMENT header. We verify + settle through the x402 facilitator, which
// submits the tx on-chain and returns a REAL tx hash we store as the ledger's
// x402_tx (the agent→us leg, alongside cost_usd, the us→vendor leg).
//
// Throw-safe around config: x402Enabled() is false unless X402_ENABLED=true.

import { exact } from "x402/schemes";
import { processPriceToAtomicAmount } from "x402/shared";
import { useFacilitator } from "x402/verify";
import { facilitator as cdpFacilitator } from "@coinbase/x402";
import type { PaymentRequirements, PaymentPayload } from "x402/types";

const NETWORK = "base-sepolia" as const;

export function x402Enabled(): boolean {
  return process.env.X402_ENABLED === "true";
}

/** Agent-facing price per paid call (what the agent pays us in USDC). */
function agentPrice(): string {
  // Default $0.01 — comfortably above the sub-cent vendor cost, clearly
  // visible on a block explorer, well under the faucet drip.
  const p = process.env.X402_PRICE_USDC || "0.01";
  return p.startsWith("$") ? p : `$${p}`;
}

/** Where the agent's USDC lands — Invariant's treasury (a CDP-managed account). */
function payTo(): string {
  return (
    process.env.X402_PAY_TO ||
    process.env.CDP_TREASURY_ADDRESS ||
    "0x08eC739eA6C436de14331FFE4Bb16c6CBE52ff3A"
  );
}

/**
 * The facilitator that verifies + settles. Prefer the CDP-hosted facilitator
 * (reliable settlement RPC, authenticated with our CDP keys) per CLAUDE.md.
 * Falls back to the public x402.org facilitator when CDP creds are absent —
 * that one shares a public Base Sepolia RPC and can hit "over rate limit".
 */
function facilitator() {
  if (process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET) {
    // `as any`: @coinbase/x402 bundles its own @x402/core whose FacilitatorConfig
    // type is structurally identical but nominally distinct from x402's. Runtime
    // shape matches; the cast just bridges the dual-package type boundary.
    return useFacilitator(cdpFacilitator as any);
  }
  const url = process.env.X402_FACILITATOR_URL;
  return url ? useFacilitator({ url: url as `${string}://${string}` }) : useFacilitator();
}

/**
 * Build the PaymentRequirements for one paid call. `resource` is the canonical
 * URL the payment buys (e.g. https://host/api/query#google_maps.geocode).
 */
export function buildRequirements(
  resource: string,
  description: string,
): PaymentRequirements {
  const priced = processPriceToAtomicAmount(agentPrice(), NETWORK);
  if ("error" in priced) {
    throw new Error(`x402 price error: ${priced.error}`);
  }
  const { maxAmountRequired, asset } = priced;
  // base-sepolia is EVM, so the asset always carries eip712 metadata.
  const eip712 = "eip712" in asset ? asset.eip712 : { name: "USDC", version: "2" };
  return {
    scheme: "exact",
    network: NETWORK,
    maxAmountRequired,
    resource: resource as `${string}://${string}`,
    description,
    mimeType: "application/json",
    payTo: payTo(),
    maxTimeoutSeconds: 60,
    asset: asset.address,
    outputSchema: undefined,
    extra: {
      name: eip712.name,
      version: eip712.version,
    },
  };
}

export interface SettleResult {
  ok: boolean;
  txHash?: string;
  payer?: string;
  network?: string;
  reason?: string;
}

/**
 * Verify the X-PAYMENT header against `requirements` and settle on-chain.
 * Returns the real tx hash on success. Never throws — settlement failure is a
 * payment failure, surfaced as { ok: false, reason }.
 */
export async function settlePayment(
  xPaymentHeader: string,
  requirements: PaymentRequirements,
): Promise<SettleResult> {
  const { verify, settle } = facilitator();
  let payload: PaymentPayload;
  try {
    payload = exact.evm.decodePayment(xPaymentHeader);
  } catch (e) {
    return { ok: false, reason: `malformed X-PAYMENT: ${(e as Error).message}` };
  }

  try {
    const v = await verify(payload, requirements);
    if (!v.isValid) {
      return { ok: false, reason: v.invalidReason || "payment failed verification", payer: v.payer };
    }
    const s = await settle(payload, requirements);
    if (!s.success) {
      return { ok: false, reason: s.errorReason || "settlement failed", payer: s.payer };
    }
    return {
      ok: true,
      txHash: s.transaction,
      payer: s.payer,
      network: s.network,
    };
  } catch (e) {
    return { ok: false, reason: `facilitator error: ${(e as Error).message}` };
  }
}
