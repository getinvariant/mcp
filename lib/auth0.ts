// Auth0 JWT verification using `jose`.
//
// Per MCP Authorization spec (OAuth 2.1), the client presents a Bearer token
// via `Authorization: Bearer <jwt>`. We verify the signature against Auth0's
// published JWKS, then validate `iss`, `aud`, and (optionally) required scopes.
//
// The JWKS is fetched lazily on first use and cached + auto-rotated by `jose`
// — we don't need separate JWKS caching code.

import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyResult,
} from "jose";

/** Custom claims we attach to Auth0 access tokens via an Auth0 Action. */
export interface PLAuth0Claims extends JWTPayload {
  /** Stable user identifier from Auth0 (e.g. "auth0|abc123" or "google-oauth2|..."). */
  sub: string;
  /** User email — only present when the user grants the `email` scope on login. */
  email?: string;
  /** Custom claim populated by an Auth0 post-login Action from Stripe state. */
  "https://invariant.dev/tier"?: "free" | "starter" | "pro" | "scale";
  /** Auth0 default — space-separated scopes. */
  scope?: string;
  /** Auth0 default for permissions if the RBAC extension is on. */
  permissions?: string[];
}

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (jwksCache) return jwksCache;
  const domain = process.env.AUTH0_DOMAIN;
  if (!domain) {
    throw new Error("AUTH0_DOMAIN env var not set (e.g. 'invariant.us.auth0.com')");
  }
  const jwksUri = `https://${domain}/.well-known/jwks.json`;
  jwksCache = createRemoteJWKSet(new URL(jwksUri), {
    cacheMaxAge: 10 * 60 * 1000, // 10 min — `jose` will also force-refresh on unknown kid
    cooldownDuration: 30_000, // throttle refresh attempts when key isn't found
  });
  return jwksCache;
}

export interface VerifyResult {
  ok: true;
  claims: PLAuth0Claims;
}

export interface VerifyError {
  ok: false;
  error: string;
  status: 401 | 403;
}

/**
 * Verify an Auth0-issued JWT. Returns either ok:true with parsed claims, or
 * ok:false with the HTTP status the caller should serve.
 */
export async function verifyAuth0Token(
  token: string,
): Promise<VerifyResult | VerifyError> {
  const domain = process.env.AUTH0_DOMAIN;
  const audience = process.env.AUTH0_AUDIENCE;
  if (!domain || !audience) {
    return {
      ok: false,
      error: "Auth0 not configured (AUTH0_DOMAIN / AUTH0_AUDIENCE missing)",
      status: 401,
    };
  }

  try {
    const result: JWTVerifyResult = await jwtVerify(token, getJwks(), {
      issuer: `https://${domain}/`,
      audience,
      // jose enforces exp/nbf by default; algorithm pinned to Auth0's RS256.
      algorithms: ["RS256"],
    });
    return { ok: true, claims: result.payload as PLAuth0Claims };
  } catch (err) {
    const message = (err as Error).message || "JWT verification failed";
    // jose throws specific subclasses; map a few common ones to clearer errors.
    if (/exp/i.test(message)) return { ok: false, error: "Token expired", status: 401 };
    if (/aud/i.test(message)) return { ok: false, error: "Wrong audience", status: 403 };
    if (/iss/i.test(message)) return { ok: false, error: "Wrong issuer", status: 401 };
    return { ok: false, error: `Token invalid: ${message}`, status: 401 };
  }
}

/** Extract the Bearer token from an Authorization header, or null. */
export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}

/**
 * Check that a token's scopes include all required values.
 * Returns missing scopes (empty array = all present).
 */
export function missingScopes(
  claims: PLAuth0Claims,
  required: string[],
): string[] {
  const scopes = new Set<string>([
    ...(claims.scope?.split(" ") ?? []),
    ...(claims.permissions ?? []),
  ]);
  return required.filter((s) => !scopes.has(s));
}
