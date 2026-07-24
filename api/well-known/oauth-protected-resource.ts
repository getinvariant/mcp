// Protected Resource Metadata, per MCP Authorization spec.
//
// MCP clients discover where to send the user for OAuth by GETting this
// endpoint. They read `authorization_servers`, fetch the upstream metadata
// from `/.well-known/oauth-authorization-server`, and drive PKCE from there.
//
// We point clients at Auth0 — they handle login UI, MFA, token issuance.

export default async function handler(_req: any, res: any) {
  const domain = process.env.AUTH0_DOMAIN;
  const audience = process.env.AUTH0_AUDIENCE;
  if (!domain || !audience) {
    return res
      .status(500)
      .json({ error: "Auth0 not configured on server" });
  }

  // Use the request host as the resource identifier so this resolves
  // correctly across preview deployments + custom domains.
  const host = _req.headers["x-forwarded-host"] || _req.headers["host"] || "";
  const proto = _req.headers["x-forwarded-proto"] || "https";
  const resource = `${proto}://${host}`;

  res.setHeader("Content-Type", "application/json");
  // 24h cache — clients hit this rarely.
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.status(200).json({
    resource,
    authorization_servers: [`https://${domain}`],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://invariant.dev/docs/auth",
    scopes_supported: [
      "providers:read",
      "providers:invoke",
      "routing:read",
      "usage:read",
    ],
    // Helps DCR-capable clients pick a sensible audience.
    resource_signing_alg_values_supported: ["RS256"],
    audience,
  });
}
