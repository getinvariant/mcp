#!/usr/bin/env tsx
import http from "node:http";
import querystring from "node:querystring";
import crypto from "node:crypto";

import providersHandler from "./api/providers.js";
import queryHandler from "./api/query.js";
import mcpHandler from "./api/mcp.js";
import usageHandler from "./api/usage.js";
import { getAllProviders } from "./lib/providers/registry.js";
import { getAccount, getUsage } from "./lib/db.js";

const PORT = Number(process.env.PORT) || 3000;

// ─── OAuth 2.0 ──────────────────────────────────────────────────────────────

type PendingCode = { apiKey: string; redirectUri: string; codeChallenge: string; expiresAt: number };
const pendingCodes = new Map<string, PendingCode>();
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of pendingCodes) if (data.expiresAt < now) pendingCodes.delete(code);
}, 60_000);

function getBaseUrl(req: http.IncomingMessage): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  return `${proto}://${req.headers.host || `localhost:${PORT}`}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function verifyPKCE(verifier: string, challenge: string): boolean {
  const hash = crypto.createHash("sha256").update(verifier).digest("base64url");
  return hash === challenge;
}

function parseFormBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      const parsed = querystring.parse(data);
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) result[k] = Array.isArray(v) ? v[0]! : (v ?? "");
      resolve(result);
    });
  });
}

function renderAuthorizeForm(opts: {
  clientId: string; redirectUri: string; state: string;
  codeChallenge: string; codeChallengeMethod: string; error?: string;
}): string {
  const { clientId, redirectUri, state, codeChallenge, codeChallengeMethod, error } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Procurement Labs — Connect</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Inter',-apple-system,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1.5rem}
  .card{width:100%;max-width:380px}
  h1{font-size:1.1rem;font-weight:600;color:#fff;margin-bottom:.25rem}
  .sub{font-size:.85rem;color:#737373;margin-bottom:1.5rem}
  .error{background:rgba(255,80,80,.1);border:1px solid rgba(255,80,80,.3);color:#f87171;font-size:.8rem;padding:.75rem 1rem;border-radius:.5rem;margin-bottom:1rem}
  input{width:100%;background:#111;border:1px solid #262626;border-radius:.5rem;padding:.75rem 1rem;color:#e5e5e5;font-size:.9rem;font-family:'JetBrains Mono',monospace;outline:none;transition:border-color .15s;margin-bottom:.75rem}
  input:focus{border-color:#525252}
  input::placeholder{color:#404040}
  button{width:100%;background:#e5e5e5;color:#0a0a0a;border:none;border-radius:.5rem;padding:.75rem;font-size:.9rem;font-weight:600;cursor:pointer;transition:background .15s}
  button:hover{background:#fff}
  .hint{font-size:.75rem;color:#404040;margin-top:1rem;text-align:center}
  .hint a{color:#525252;text-decoration:none}
  .hint a:hover{color:#a3a3a3}
</style>
</head>
<body>
<div class="card">
  <h1>Procurement Labs</h1>
  <p class="sub">Enter your API key to connect</p>
  ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
  <form method="POST" action="/authorize">
    <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
    <input type="hidden" name="state" value="${escapeHtml(state)}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
    <input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}">
    <input name="api_key" placeholder="pl_…" autofocus autocomplete="off" spellcheck="false">
    <button type="submit">Authorize</button>
  </form>
  <p class="hint">Need a key? Contact your administrator.</p>
</div>
</body>
</html>`;
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

function makeRes(res: http.ServerResponse) {
  const r: any = res;
  const originalEnd = res.end.bind(res);
  r.status = (code: number) => { res.statusCode = code; return r; };
  r.json = (obj: unknown) => {
    res.setHeader("Content-Type", "application/json");
    originalEnd(JSON.stringify(obj));
    return r;
  };
  return r;
}

function getHealthData() {
  const providers = getAllProviders();
  return providers.map((p) => ({
    id: p.info.id,
    name: p.info.name,
    category: p.info.category,
    description: p.info.description,
    requiresApiKey: p.info.requiresApiKey,
    available: p.isAvailable(),
    actions: p.info.availableActions.map((a) => ({
      name: a.action,
      description: a.description,
      params: Object.entries(a.parameters).map(([k, v]) => ({
        name: k, type: v.type, required: v.required, description: v.description,
      })),
    })),
  }));
}

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  physical_health: { label: "Health", icon: "H" },
  mental_health: { label: "Mental Health", icon: "M" },
  ai: { label: "AI", icon: "A" },
  financial: { label: "Finance", icon: "F" },
  social_impact: { label: "Social Impact", icon: "S" },
  environment: { label: "Environment", icon: "E" },
  maps: { label: "Maps", icon: "G" },
  cloud: { label: "Cloud", icon: "C" },
};

interface UsageData {
  tier: string;
  quota: number;
  used: number;
  remaining: number;
  resets: string;
  breakdown: { provider: string; count: number }[];
  perMinuteRate: number;
}

function renderDashboard(usage?: UsageData): string {
  const providers = getHealthData();
  const total = providers.length;
  const live = providers.filter((p) => p.available).length;
  const noKey = providers.filter((p) => !p.requiresApiKey).length;

  const grouped: Record<string, typeof providers> = {};
  for (const p of providers) {
    const cat = p.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(p);
  }

  const categoryCards = Object.entries(grouped)
    .map(([cat, provs]) => {
      const meta = CATEGORY_META[cat] || { label: cat, icon: "·" };
      const providerRows = provs
        .map((p) => {
          const status = p.available
            ? `<span class="badge live">LIVE</span>`
            : p.requiresApiKey
              ? `<span class="badge no-key">NO KEY</span>`
              : `<span class="badge live">LIVE</span>`;
          const actionList = p.actions
            .map((a) => {
              const params = a.params
                .map((pr) => `<span class="param${pr.required ? " required" : ""}">${pr.name}</span>`)
                .join(" ");
              return `<div class="action"><code>${a.name}</code><span class="action-desc">${a.description}</span><div class="params">${params}</div></div>`;
            })
            .join("");
          return `
            <div class="provider">
              <div class="provider-header">
                <div class="provider-title">
                  <h3>${p.name}</h3>
                  <span class="provider-id">${p.id}</span>
                </div>
                ${status}
              </div>
              <p class="provider-desc">${p.description}</p>
              <div class="actions-list">${actionList}</div>
            </div>`;
        })
        .join("");
      return `
        <div class="category">
          <div class="category-header">
            <span class="category-icon">${meta.icon}</span>
            <h2>${meta.label}</h2>
            <span class="category-count">${provs.length}</span>
          </div>
          ${providerRows}
        </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Procurement Labs</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: #0a0a0a;
    color: #e5e5e5;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  .container {
    max-width: 960px;
    margin: 0 auto;
    padding: 3rem 1.5rem 4rem;
  }

  /* Header */
  header {
    margin-bottom: 3rem;
  }
  header h1 {
    font-size: 1.75rem;
    font-weight: 600;
    letter-spacing: -0.03em;
    color: #fff;
    margin-bottom: 0.5rem;
  }
  header p {
    color: #737373;
    font-size: 0.9rem;
  }

  /* Stats bar */
  .stats {
    display: flex;
    gap: 1px;
    background: #1c1c1c;
    border-radius: 0.75rem;
    overflow: hidden;
    margin-bottom: 2.5rem;
    border: 1px solid #262626;
  }
  .stat {
    flex: 1;
    padding: 1.25rem 1.5rem;
    background: #111;
  }
  .stat-value {
    font-size: 1.5rem;
    font-weight: 600;
    color: #fff;
    font-variant-numeric: tabular-nums;
  }
  .stat-value.green { color: #d4d4d4; }
  .stat-value.amber { color: #a3a3a3; }
  .stat-label {
    font-size: 0.75rem;
    color: #737373;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 0.25rem;
  }

  /* Endpoints */
  .endpoints {
    background: #111;
    border: 1px solid #262626;
    border-radius: 0.75rem;
    padding: 1.25rem 1.5rem;
    margin-bottom: 2.5rem;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.8rem;
  }
  .endpoints h2 {
    font-family: 'Inter', sans-serif;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #737373;
    margin-bottom: 0.75rem;
    font-weight: 500;
  }
  .endpoint {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.4rem 0;
    color: #a3a3a3;
  }
  .method {
    font-weight: 500;
    min-width: 3rem;
  }
  .method.get { color: #a3a3a3; }
  .method.post { color: #a3a3a3; }
  .endpoint-path { color: #e5e5e5; }
  .endpoint-desc { color: #525252; margin-left: auto; font-family: 'Inter', sans-serif; font-size: 0.75rem; }

  /* Categories */
  .category {
    margin-bottom: 2rem;
  }
  .category-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #1c1c1c;
  }
  .category-icon {
    width: 1.5rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #1c1c1c;
    border-radius: 0.375rem;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.65rem;
    font-weight: 500;
    color: #525252;
  }
  .category-header h2 {
    font-size: 0.8rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #a3a3a3;
  }
  .category-count {
    font-size: 0.7rem;
    color: #525252;
    background: #1c1c1c;
    padding: 0.125rem 0.5rem;
    border-radius: 1rem;
    font-variant-numeric: tabular-nums;
  }

  /* Provider cards */
  .provider {
    background: #111;
    border: 1px solid #262626;
    border-radius: 0.75rem;
    padding: 1.25rem 1.5rem;
    margin-bottom: 0.5rem;
    transition: border-color 0.15s;
  }
  .provider:hover {
    border-color: #333;
  }
  .provider-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.5rem;
  }
  .provider-title {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .provider-title h3 {
    font-size: 0.95rem;
    font-weight: 500;
    color: #fff;
  }
  .provider-id {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.7rem;
    color: #525252;
  }
  .provider-desc {
    font-size: 0.8rem;
    color: #737373;
    margin-bottom: 1rem;
  }

  /* Badges */
  .badge {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.2rem 0.6rem;
    border-radius: 1rem;
  }
  .badge.live {
    background: rgba(255, 255, 255, 0.06);
    color: #a3a3a3;
    border: 1px solid #333;
  }
  .badge.no-key {
    background: rgba(255, 255, 255, 0.03);
    color: #525252;
    border: 1px solid #262626;
  }

  /* Actions */
  .actions-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .action {
    background: #0a0a0a;
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
  }
  .action code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.8rem;
    color: #d4d4d4;
    font-weight: 400;
  }
  .action-desc {
    font-size: 0.75rem;
    color: #525252;
    margin-left: 0.75rem;
  }
  .params {
    margin-top: 0.375rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }
  .param {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.65rem;
    padding: 0.15rem 0.5rem;
    background: #1c1c1c;
    border-radius: 0.25rem;
    color: #737373;
  }
  .param.required {
    color: #a3a3a3;
    background: #1c1c1c;
  }

  /* Footer */
  footer {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid #1c1c1c;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  footer span {
    font-size: 0.75rem;
    color: #404040;
  }
  footer a {
    font-size: 0.75rem;
    color: #525252;
    text-decoration: none;
    transition: color 0.15s;
  }
  footer a:hover { color: #a3a3a3; }

  /* Usage panel */
  .usage-panel {
    background: #111;
    border: 1px solid #262626;
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-bottom: 2.5rem;
  }
  .usage-panel h2 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #737373;
    margin-bottom: 1rem;
    font-weight: 500;
  }
  .usage-meta {
    display: flex;
    gap: 2rem;
    margin-bottom: 1rem;
    font-size: 0.8rem;
    color: #737373;
  }
  .usage-meta span { color: #a3a3a3; }
  .quota-bar-outer {
    width: 100%;
    height: 6px;
    background: #1c1c1c;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 1rem;
  }
  .quota-bar-inner {
    height: 100%;
    background: #d4d4d4;
    border-radius: 3px;
    transition: width 0.3s;
  }
  .quota-bar-inner.warn { background: #a3a3a3; }
  .quota-bar-inner.critical { background: #737373; }
  .usage-numbers {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: #525252;
    margin-bottom: 1.25rem;
  }
  .usage-numbers span { font-variant-numeric: tabular-nums; }
  .usage-breakdown {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .usage-chip {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.7rem;
    padding: 0.25rem 0.75rem;
    background: #0a0a0a;
    border-radius: 0.375rem;
    color: #737373;
  }
  .usage-chip .chip-count {
    color: #d4d4d4;
    margin-left: 0.375rem;
  }
  .usage-login {
    background: #111;
    border: 1px solid #262626;
    border-radius: 0.75rem;
    padding: 1.25rem 1.5rem;
    margin-bottom: 2.5rem;
    font-size: 0.8rem;
    color: #525252;
  }
  .usage-login code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    color: #a3a3a3;
    background: #1c1c1c;
    padding: 0.15rem 0.4rem;
    border-radius: 0.25rem;
  }

  @media (max-width: 640px) {
    .stats { flex-direction: column; }
    .endpoint-desc { display: none; }
    .provider-title { flex-direction: column; gap: 0.125rem; }
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Procurement Labs</h1>
    <p>Unified API gateway for AI agents — ${total} providers across ${Object.keys(grouped).length} categories</p>
  </header>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">${total}</div>
      <div class="stat-label">Total Providers</div>
    </div>
    <div class="stat">
      <div class="stat-value green">${live}</div>
      <div class="stat-label">Live</div>
    </div>
    <div class="stat">
      <div class="stat-value amber">${total - live}</div>
      <div class="stat-label">Needs API Key</div>
    </div>
    <div class="stat">
      <div class="stat-value">${noKey}</div>
      <div class="stat-label">Free (No Key)</div>
    </div>
  </div>

  ${usage ? `
  <div class="usage-panel">
    <h2>Your Usage — ${usage.tier} tier</h2>
    <div class="usage-meta">
      <div>Quota: <span>${usage.used} / ${usage.quota}</span></div>
      <div>Rate limit: <span>${usage.perMinuteRate} req/min</span></div>
      <div>Resets: <span>${usage.resets}</span></div>
    </div>
    <div class="quota-bar-outer">
      <div class="quota-bar-inner${usage.used / usage.quota > 0.9 ? ' critical' : usage.used / usage.quota > 0.7 ? ' warn' : ''}" style="width: ${Math.min(100, (usage.used / usage.quota) * 100)}%"></div>
    </div>
    <div class="usage-numbers">
      <span>${usage.remaining} remaining</span>
      <span>${Math.round((usage.used / usage.quota) * 100)}% used</span>
    </div>
    ${usage.breakdown.length > 0 ? `
    <div class="usage-breakdown">
      ${usage.breakdown.map(b => `<span class="usage-chip">${b.provider}<span class="chip-count">${b.count}</span></span>`).join("")}
    </div>` : ""}
  </div>` : `
  <div class="usage-login">
    View your usage by adding your key: <code>?key=pl_your_key</code>
  </div>`}

  <div class="endpoints">
    <h2>Endpoints</h2>
    <div class="endpoint"><span class="method get">GET</span><span class="endpoint-path">/api/providers</span><span class="endpoint-desc">list available providers</span></div>
    <div class="endpoint"><span class="method post">POST</span><span class="endpoint-path">/api/query</span><span class="endpoint-desc">execute a provider action</span></div>
    <div class="endpoint"><span class="method post">POST</span><span class="endpoint-path">/api/mcp</span><span class="endpoint-desc">MCP protocol (JSON-RPC)</span></div>
    <div class="endpoint"><span class="method get">GET</span><span class="endpoint-path">/api/usage</span><span class="endpoint-desc">check quota and usage breakdown</span></div>
  </div>

  ${categoryCards}

  <footer>
    <span>procurement labs v0.1.0</span>
    <a href="https://github.com/tobasummandal/procurementlabs">github</a>
  </footer>
</div>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const [path, qs] = (req.url || "").split("?");

  // ── OAuth endpoints ────────────────────────────────────────────────────────
  if (path === "/.well-known/oauth-authorization-server") {
    const base = getBaseUrl(req);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    }));
  }

  if (path === "/register" && req.method === "POST") {
    res.writeHead(201, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      client_id: crypto.randomBytes(16).toString("hex"),
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }));
  }

  if (path === "/authorize") {
    if (req.method === "GET") {
      const params = querystring.parse(qs || "");
      const get = (k: string) => (Array.isArray(params[k]) ? params[k]![0] : params[k] as string) ?? "";
      if (get("response_type") !== "code") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "unsupported_response_type" }));
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderAuthorizeForm({
        clientId: get("client_id"), redirectUri: get("redirect_uri"),
        state: get("state"), codeChallenge: get("code_challenge"),
        codeChallengeMethod: get("code_challenge_method") || "S256",
      }));
    }
    if (req.method === "POST") {
      const body = await parseFormBody(req);
      const { client_id, redirect_uri, state, code_challenge, code_challenge_method, api_key } = body;
      const account = await getAccount(api_key);
      if (!account) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(renderAuthorizeForm({
          clientId: client_id ?? "", redirectUri: redirect_uri ?? "",
          state: state ?? "", codeChallenge: code_challenge ?? "",
          codeChallengeMethod: code_challenge_method ?? "S256",
          error: "Invalid API key. Check your key and try again.",
        }));
      }
      const code = crypto.randomBytes(20).toString("hex");
      pendingCodes.set(code, {
        apiKey: api_key, redirectUri: redirect_uri ?? "",
        codeChallenge: code_challenge ?? "", expiresAt: Date.now() + 5 * 60_000,
      });
      const callback = new URL(redirect_uri ?? "");
      if (state) callback.searchParams.set("state", state);
      callback.searchParams.set("code", code);
      res.writeHead(302, { Location: callback.toString() });
      return res.end();
    }
  }

  if (path === "/token" && req.method === "POST") {
    const body = await parseFormBody(req);
    const { grant_type, code, redirect_uri, code_verifier } = body;
    if (grant_type !== "authorization_code") {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "unsupported_grant_type" }));
    }
    const pending = code ? pendingCodes.get(code) : undefined;
    if (!pending || pending.expiresAt < Date.now()) {
      pendingCodes.delete(code ?? "");
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid_grant", error_description: "Code expired or not found" }));
    }
    if (pending.redirectUri !== redirect_uri || !code_verifier || !verifyPKCE(code_verifier, pending.codeChallenge)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid_grant", error_description: "PKCE or redirect_uri mismatch" }));
    }
    pendingCodes.delete(code!);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ access_token: pending.apiKey, token_type: "bearer" }));
  }

  // ── API routes ─────────────────────────────────────────────────────────────
  const body = await parseBody(req);

  // Lift Bearer token → x-pl-key so existing handlers validate it transparently
  const authHeader = req.headers["authorization"];
  if (authHeader?.toLowerCase().startsWith("bearer ") && !req.headers["x-pl-key"]) {
    (req.headers as any)["x-pl-key"] = authHeader.slice(7);
  }

  const fakeReq: any = {
    method: req.method,
    headers: req.headers,
    url: req.url,
    query: querystring.parse(qs || ""),
    body,
  };

  const fakeRes = makeRes(res);

  if (path === "/") {
    const key = fakeReq.query.key as string | undefined;
    let usage: UsageData | undefined;

    if (key && key.startsWith("pl_")) {
      const account = await getAccount(key);
      if (account) {
        const breakdown = await getUsage(account.id);
        const used = breakdown.reduce((sum, r) => sum + r.count, 0);
        const now = new Date();
        const resets = new Date(now.getFullYear(), now.getMonth() + 1, 1)
          .toISOString().slice(0, 10);
        usage = {
          tier: account.tier,
          quota: account.monthly_quota,
          used,
          remaining: Math.max(0, account.monthly_quota - used),
          resets,
          breakdown: breakdown.map(r => ({ provider: r.provider_id, count: r.count })),
          perMinuteRate: account.per_minute_rate,
        };
      }
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(renderDashboard(usage));
  }

  if (path === "/api/health") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ status: "ok", providers: getHealthData() }));
  }

  if (path === "/api/providers") return providersHandler(fakeReq, fakeRes);
  if (path === "/api/query") return queryHandler(fakeReq, fakeRes);
  if (path === "/api/mcp") return mcpHandler(fakeReq, fakeRes);
  if (path === "/api/usage") return usageHandler(fakeReq, fakeRes);

  res.statusCode = 404;
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`dev server running on http://localhost:${PORT}`);
});
