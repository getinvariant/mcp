#!/usr/bin/env tsx
import http from "node:http";
import querystring from "node:querystring";
import crypto from "node:crypto";

import providersHandler from "./api/providers.js";
import queryHandler from "./api/query.js";
import mcpHandler from "./api/mcp.js";
import usageHandler from "./api/usage.js";
import { getAllProviders } from "./lib/providers/registry.js";
import { getAccount, getUsage, getAllAccounts, createAccount } from "./lib/db.js";

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

interface AccountWithUsage {
  key: string;
  email: string | null;
  tier: string;
  quota: number;
  used: number;
  remaining: number;
  perMinuteRate: number;
  createdAt: string;
}

function renderDashboard(): string {
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

  /* Usage key form */
  .usage-section { margin-bottom: 2.5rem; }
  .usage-key-form {
    background: #111;
    border: 1px solid #262626;
    border-radius: 0.75rem;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1rem;
  }
  .usage-key-form h2 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #737373;
    margin-bottom: 0.75rem;
    font-weight: 500;
  }

  /* Tabs */
  .tabs {
    display: flex;
    gap: 0;
    margin-bottom: 2rem;
    border-bottom: 1px solid #262626;
  }
  .tab {
    padding: 0.75rem 1.5rem;
    font-size: 0.8rem;
    font-weight: 500;
    color: #525252;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .tab:hover { color: #a3a3a3; }
  .tab.active { color: #e5e5e5; border-bottom-color: #e5e5e5; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* Admin */
  .admin-login {
    background: #111;
    border: 1px solid #262626;
    border-radius: 0.75rem;
    padding: 1.5rem;
    max-width: 380px;
  }
  .admin-login h2 {
    font-size: 0.85rem;
    font-weight: 500;
    color: #e5e5e5;
    margin-bottom: 0.75rem;
  }
  .admin-login input {
    width: 100%;
    background: #0a0a0a;
    border: 1px solid #262626;
    border-radius: 0.5rem;
    padding: 0.6rem 1rem;
    color: #e5e5e5;
    font-size: 0.85rem;
    font-family: 'JetBrains Mono', monospace;
    outline: none;
    margin-bottom: 0.75rem;
    transition: border-color 0.15s;
  }
  .admin-login input:focus { border-color: #525252; }
  .admin-login button {
    background: #e5e5e5;
    color: #0a0a0a;
    border: none;
    border-radius: 0.5rem;
    padding: 0.6rem 1.5rem;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }
  .admin-login button:hover { background: #fff; }
  .admin-error {
    color: #f87171;
    font-size: 0.75rem;
    margin-top: 0.5rem;
  }

  .accounts-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  .accounts-table th {
    text-align: left;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #525252;
    font-weight: 500;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #262626;
  }
  .accounts-table td {
    padding: 0.75rem;
    border-bottom: 1px solid #1c1c1c;
    color: #a3a3a3;
    vertical-align: middle;
  }
  .accounts-table tr:hover td { background: #111; }
  .key-cell {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    cursor: pointer;
    color: #737373;
    transition: color 0.15s;
  }
  .key-cell:hover { color: #e5e5e5; }
  .key-cell .copy-hint {
    font-family: 'Inter', sans-serif;
    font-size: 0.6rem;
    color: #404040;
    margin-left: 0.5rem;
  }
  .mini-bar {
    width: 80px;
    height: 4px;
    background: #1c1c1c;
    border-radius: 2px;
    overflow: hidden;
    display: inline-block;
    vertical-align: middle;
    margin-right: 0.5rem;
  }
  .mini-bar-inner {
    height: 100%;
    background: #d4d4d4;
    border-radius: 2px;
  }
  .mini-bar-inner.warn { background: #a3a3a3; }
  .mini-bar-inner.critical { background: #737373; }
  .tier-badge {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.15rem 0.5rem;
    border-radius: 1rem;
    background: rgba(255,255,255,0.06);
    color: #a3a3a3;
    border: 1px solid #333;
  }

  /* Create key form */
  .create-key {
    background: #111;
    border: 1px solid #262626;
    border-radius: 0.75rem;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.5rem;
  }
  .create-key h2 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #737373;
    margin-bottom: 1rem;
    font-weight: 500;
  }
  .create-key-form {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .form-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .form-field label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #525252;
  }
  .form-field input, .form-field select {
    background: #0a0a0a;
    border: 1px solid #262626;
    border-radius: 0.375rem;
    padding: 0.5rem 0.75rem;
    color: #e5e5e5;
    font-size: 0.8rem;
    outline: none;
    transition: border-color 0.15s;
  }
  .form-field input:focus, .form-field select:focus { border-color: #525252; }
  .form-field select { cursor: pointer; }
  .create-btn {
    background: #e5e5e5;
    color: #0a0a0a;
    border: none;
    border-radius: 0.375rem;
    padding: 0.5rem 1.25rem;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    height: fit-content;
  }
  .create-btn:hover { background: #fff; }

  /* Flash */
  .flash {
    background: rgba(255,255,255,0.04);
    border: 1px solid #333;
    border-radius: 0.5rem;
    padding: 1rem 1.25rem;
    margin-bottom: 1.5rem;
    display: none;
  }
  .flash.visible { display: block; }
  .flash-label {
    font-size: 0.7rem;
    color: #525252;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.375rem;
  }
  .flash-key {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.9rem;
    color: #e5e5e5;
    cursor: pointer;
    word-break: break-all;
  }
  .flash-key:hover { color: #fff; }
  .flash-sub {
    font-size: 0.7rem;
    color: #404040;
    margin-top: 0.375rem;
  }

  .copied-toast {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    background: #e5e5e5;
    color: #0a0a0a;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
  }
  .copied-toast.show { opacity: 1; }

  @media (max-width: 640px) {
    .stats { flex-direction: column; }
    .endpoint-desc { display: none; }
    .provider-title { flex-direction: column; gap: 0.125rem; }
    .create-key-form { flex-direction: column; }
    .accounts-table { font-size: 0.7rem; }
    #usage-logged-out > div:first-child { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Procurement Labs</h1>
    <p>Unified API gateway for AI agents — ${total} providers across ${Object.keys(grouped).length} categories</p>
  </header>

  <div class="tabs">
    <div class="tab active" data-tab="home">Home</div>
    <div class="tab" data-tab="admin">Admin</div>
  </div>

  <!-- Home Tab -->
  <div id="tab-home" class="tab-content active">
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

    <!-- Usage: logged-in state -->
    <div id="usage-logged-in" class="usage-panel" style="display:none">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <h2 id="usage-title" style="margin:0"></h2>
        <div style="display:flex;align-items:center;gap:1rem">
          <span id="usage-key-display" style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;color:#525252;cursor:pointer" title="Click to copy full key"></span>
          <button id="usage-signout" style="background:none;border:1px solid #262626;border-radius:0.375rem;padding:0.3rem 0.75rem;color:#525252;font-size:0.7rem;cursor:pointer;transition:color .15s">sign out</button>
        </div>
      </div>
      <div class="usage-meta">
        <div>Quota: <span id="usage-quota-text"></span></div>
        <div>Rate limit: <span id="usage-rate-text"></span></div>
        <div>Resets: <span id="usage-resets-text"></span></div>
      </div>
      <div class="quota-bar-outer">
        <div class="quota-bar-inner" id="usage-bar"></div>
      </div>
      <div class="usage-numbers">
        <span id="usage-remaining-text"></span>
        <span id="usage-pct-text"></span>
      </div>
      <div class="usage-breakdown" id="usage-breakdown"></div>
    </div>

    <!-- Logged-out: sign in or sign up -->
    <div id="usage-logged-out" style="display:none">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        <!-- Sign in -->
        <div class="usage-key-form">
          <h2>Sign In</h2>
          <p style="font-size:0.8rem;color:#525252;margin-bottom:0.75rem">Already have a key?</p>
          <input type="text" id="usage-key" placeholder="pl_your_key" autocomplete="off" spellcheck="false" style="width:100%;background:#0a0a0a;border:1px solid #262626;border-radius:0.5rem;padding:0.6rem 1rem;color:#e5e5e5;font-size:0.85rem;font-family:'JetBrains Mono',monospace;outline:none;transition:border-color .15s;margin-bottom:0.75rem">
          <button id="usage-lookup-btn" style="width:100%;background:#e5e5e5;color:#0a0a0a;border:none;border-radius:0.5rem;padding:0.6rem 1rem;font-size:0.8rem;font-weight:600;cursor:pointer;transition:background .15s">Sign in</button>
          <div id="usage-error" class="admin-error"></div>
        </div>
        <!-- Sign up -->
        <div class="usage-key-form">
          <h2>Create Account</h2>
          <p style="font-size:0.8rem;color:#525252;margin-bottom:0.75rem">Get a free API key — 500 requests/month</p>
          <input type="email" id="signup-email" placeholder="you@example.com" style="width:100%;background:#0a0a0a;border:1px solid #262626;border-radius:0.5rem;padding:0.6rem 1rem;color:#e5e5e5;font-size:0.85rem;outline:none;transition:border-color .15s;margin-bottom:0.75rem">
          <button id="signup-btn" style="width:100%;background:#e5e5e5;color:#0a0a0a;border:none;border-radius:0.5rem;padding:0.6rem 1rem;font-size:0.8rem;font-weight:600;cursor:pointer;transition:background .15s">Create key</button>
          <div id="signup-error" class="admin-error"></div>
        </div>
      </div>
      <!-- New key flash -->
      <div id="signup-flash" class="flash" style="margin-top:1rem">
        <div class="flash-label">Your API key — copy it now, it won't be shown again</div>
        <div id="signup-flash-key" class="flash-key"></div>
        <div class="flash-sub" style="margin-top:0.5rem">Add this to your MCP client config as <code style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:#a3a3a3;background:#1c1c1c;padding:0.1rem 0.3rem;border-radius:0.25rem">x-pl-key</code> header.</div>
      </div>
    </div>

    <div class="endpoints">
      <h2>Endpoints</h2>
      <div class="endpoint"><span class="method get">GET</span><span class="endpoint-path">/api/providers</span><span class="endpoint-desc">list available providers</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="endpoint-path">/api/query</span><span class="endpoint-desc">execute a provider action</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="endpoint-path">/api/mcp</span><span class="endpoint-desc">MCP protocol (JSON-RPC)</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="endpoint-path">/api/usage</span><span class="endpoint-desc">check quota and usage breakdown</span></div>
    </div>

    ${categoryCards}
  </div>

  <!-- Admin Tab -->
  <div id="tab-admin" class="tab-content">
    <div id="admin-login" class="admin-login">
      <h2>Admin Access</h2>
      <input type="password" id="admin-pass" placeholder="password" autocomplete="off">
      <button id="admin-login-btn">Unlock</button>
      <div id="admin-error" class="admin-error"></div>
    </div>

    <div id="admin-panel" style="display:none">
      <div id="key-flash" class="flash">
        <div class="flash-label">New key created — click to copy</div>
        <div id="flash-key" class="flash-key"></div>
        <div class="flash-sub">This is the only time the full key is shown.</div>
      </div>

      <div class="create-key">
        <h2>Create Key</h2>
        <div class="create-key-form">
          <div class="form-field">
            <label>Email (optional)</label>
            <input type="text" id="key-email" placeholder="user@example.com">
          </div>
          <div class="form-field">
            <label>Tier</label>
            <select id="key-tier">
              <option value="free">free</option>
              <option value="pro">pro</option>
              <option value="unlimited">unlimited</option>
            </select>
          </div>
          <div class="form-field">
            <label>Monthly Quota</label>
            <input type="number" id="key-quota" value="500" min="1" style="width:100px">
          </div>
          <div class="form-field">
            <label>Rate (req/min)</label>
            <input type="number" id="key-rate" value="10" min="1" style="width:80px">
          </div>
          <button class="create-btn" id="create-key-btn">Create</button>
        </div>
      </div>

      <table class="accounts-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Email</th>
            <th>Tier</th>
            <th>Usage</th>
            <th>Quota</th>
            <th>Rate</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody id="accounts-body"></tbody>
      </table>
    </div>
  </div>

  <footer>
    <span>procurement labs v0.1.0</span>
    <a href="https://github.com/tobasummandal/procurementlabs">github</a>
  </footer>
</div>

<div class="copied-toast" id="copied-toast">Copied</div>

<script>
(function() {
  let adminPass = null;

  // Cookie helpers
  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function setCookie(name, val) {
    document.cookie = name + '=' + encodeURIComponent(val) + '; path=/; max-age=' + (365*86400) + '; samesite=lax';
  }
  function deleteCookie(name) {
    document.cookie = name + '=; path=/; max-age=0';
  }

  // Mask key
  function maskKey(key) {
    if (key.length <= 10) return key;
    return key.slice(0, 6) + '...' + key.slice(-4);
  }

  // Usage rendering
  function showUsagePanel(u, key) {
    document.getElementById('usage-title').textContent = 'Your Usage — ' + u.tier + ' tier';
    document.getElementById('usage-key-display').textContent = maskKey(key);
    document.getElementById('usage-quota-text').textContent = u.used + ' / ' + u.quota;
    document.getElementById('usage-rate-text').textContent = (u.per_minute_rate || 10) + ' req/min';
    document.getElementById('usage-resets-text').textContent = u.resets;
    const pct = Math.min(100, (u.used / u.quota) * 100);
    const bar = document.getElementById('usage-bar');
    bar.style.width = pct + '%';
    bar.className = 'quota-bar-inner' + (pct > 90 ? ' critical' : pct > 70 ? ' warn' : '');
    document.getElementById('usage-remaining-text').textContent = u.remaining + ' remaining';
    document.getElementById('usage-pct-text').textContent = Math.round(pct) + '% used';
    document.getElementById('usage-breakdown').innerHTML = (u.breakdown || []).map(function(b) {
      return '<span class="usage-chip">' + b.provider + '<span class="chip-count">' + b.count + '</span></span>';
    }).join('');
    document.getElementById('usage-logged-in').style.display = 'block';
    document.getElementById('usage-logged-out').style.display = 'none';
  }

  function showLoggedOut() {
    document.getElementById('usage-logged-in').style.display = 'none';
    document.getElementById('usage-logged-out').style.display = 'block';
  }

  async function fetchUsage(key) {
    const res = await fetch('/api/usage', { headers: { 'x-pl-key': key } });
    if (!res.ok) return null;
    return await res.json();
  }

  // Auto-load from cookie on page load
  const savedKey = getCookie('pl_key');
  if (savedKey) {
    fetchUsage(savedKey).then(u => {
      if (u) showUsagePanel(u, savedKey);
      else { deleteCookie('pl_key'); showLoggedOut(); }
    }).catch(() => showLoggedOut());
  } else {
    showLoggedOut();
  }

  // Manual sign in
  document.getElementById('usage-lookup-btn').addEventListener('click', signIn);
  document.getElementById('usage-key').addEventListener('keydown', e => { if (e.key === 'Enter') signIn(); });

  async function signIn() {
    const key = document.getElementById('usage-key').value.trim();
    const errEl = document.getElementById('usage-error');
    errEl.textContent = '';
    if (!key) { errEl.textContent = 'Enter your API key'; return; }
    try {
      const u = await fetchUsage(key);
      if (!u) { errEl.textContent = 'Invalid key'; return; }
      setCookie('pl_key', key);
      showUsagePanel(u, key);
    } catch (e) { errEl.textContent = 'Connection error'; }
  }

  // Sign out
  // Copy full key from logged-in display
  document.getElementById('usage-key-display').addEventListener('click', () => {
    const key = getCookie('pl_key');
    if (key) {
      navigator.clipboard.writeText(key);
      var t = document.getElementById('copied-toast');
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 1200);
    }
  });

  document.getElementById('usage-signout').addEventListener('click', () => {
    deleteCookie('pl_key');
    document.getElementById('usage-key').value = '';
    showLoggedOut();
  });

  // Sign up
  document.getElementById('signup-btn').addEventListener('click', doSignup);
  document.getElementById('signup-email').addEventListener('keydown', e => { if (e.key === 'Enter') doSignup(); });

  async function doSignup() {
    const email = document.getElementById('signup-email').value.trim();
    const errEl = document.getElementById('signup-error');
    const btn = document.getElementById('signup-btn');
    errEl.textContent = '';
    if (!email || !email.includes('@')) { errEl.textContent = 'Enter a valid email'; return; }
    btn.disabled = true; btn.textContent = '...';
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || 'Signup failed'; return; }
      // Show the key
      const flash = document.getElementById('signup-flash');
      const flashKey = document.getElementById('signup-flash-key');
      flashKey.textContent = data.key;
      flashKey.onclick = () => { navigator.clipboard.writeText(data.key); var t = document.getElementById('copied-toast'); t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1200); };
      flash.classList.add('visible');
      // Auto-load usage after a moment (cookie already set by server)
      const u = await fetchUsage(data.key);
      if (u) { showUsagePanel(u, data.key); }
    } catch (e) { errEl.textContent = 'Connection error'; }
    finally { btn.disabled = false; btn.textContent = 'Create key'; }
  }

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  // Copy to clipboard
  function copyKey(key) {
    navigator.clipboard.writeText(key);
    const toast = document.getElementById('copied-toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1200);
  }

  // Mask key: pl_abcd...wxyz
  function maskKey(key) {
    if (key.length <= 10) return key;
    return key.slice(0, 6) + '...' + key.slice(-4);
  }

  // Usage bar class
  function barClass(used, quota) {
    const r = used / quota;
    if (r > 0.9) return 'critical';
    if (r > 0.7) return 'warn';
    return '';
  }

  // Render accounts table
  function renderAccounts(accounts) {
    const tbody = document.getElementById('accounts-body');
    tbody.innerHTML = accounts.map(a => {
      const pct = Math.min(100, (a.used / a.quota) * 100);
      const cls = barClass(a.used, a.quota);
      const date = new Date(a.createdAt).toLocaleDateString();
      return '<tr>'
        + '<td class="key-cell" data-key="' + a.key + '" title="Click to copy">' + maskKey(a.key) + '<span class="copy-hint">copy</span></td>'
        + '<td>' + (a.email || '<span style="color:#404040">—</span>') + '</td>'
        + '<td><span class="tier-badge">' + a.tier + '</span></td>'
        + '<td><span class="mini-bar"><span class="mini-bar-inner ' + cls + '" style="width:' + pct + '%"></span></span>' + a.used + ' / ' + a.quota + '</td>'
        + '<td>' + a.remaining + ' left</td>'
        + '<td>' + a.perMinuteRate + '/min</td>'
        + '<td style="color:#525252">' + date + '</td>'
        + '</tr>';
    }).join('');
  }

  // Click-to-copy on key cells
  document.getElementById('accounts-body').addEventListener('click', e => {
    const cell = e.target.closest('.key-cell');
    if (cell) copyKey(cell.dataset.key);
  });

  // Admin login
  document.getElementById('admin-login-btn').addEventListener('click', tryLogin);
  document.getElementById('admin-pass').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });

  async function tryLogin() {
    const pass = document.getElementById('admin-pass').value;
    const errEl = document.getElementById('admin-error');
    errEl.textContent = '';
    try {
      const res = await fetch('/api/admin/accounts', { headers: { 'x-admin-pass': pass } });
      if (!res.ok) { errEl.textContent = 'Wrong password'; return; }
      adminPass = pass;
      const data = await res.json();
      document.getElementById('admin-login').style.display = 'none';
      document.getElementById('admin-panel').style.display = 'block';
      renderAccounts(data.accounts);
    } catch (e) { errEl.textContent = 'Connection error'; }
  }

  // Create key
  document.getElementById('create-key-btn').addEventListener('click', async () => {
    const btn = document.getElementById('create-key-btn');
    btn.disabled = true;
    btn.textContent = '...';
    try {
      const res = await fetch('/api/admin/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-pass': adminPass },
        body: JSON.stringify({
          email: document.getElementById('key-email').value || undefined,
          tier: document.getElementById('key-tier').value,
          monthly_quota: Number(document.getElementById('key-quota').value),
          per_minute_rate: Number(document.getElementById('key-rate').value),
        }),
      });
      if (!res.ok) { alert('Failed to create key'); return; }
      const data = await res.json();
      // Show flash
      const flash = document.getElementById('key-flash');
      const flashKey = document.getElementById('flash-key');
      flashKey.textContent = data.account.key;
      flashKey.onclick = () => copyKey(data.account.key);
      flash.classList.add('visible');
      // Clear form
      document.getElementById('key-email').value = '';
      document.getElementById('key-tier').value = 'free';
      document.getElementById('key-quota').value = '500';
      document.getElementById('key-rate').value = '10';
      // Reload accounts
      const acRes = await fetch('/api/admin/accounts', { headers: { 'x-admin-pass': adminPass } });
      if (acRes.ok) { const d = await acRes.json(); renderAccounts(d.accounts); }
    } catch (e) { alert('Error: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = 'Create'; }
  });
})();
</script>
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
    const regBody = await parseBody(req);
    res.writeHead(201, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      client_id: crypto.randomBytes(16).toString("hex"),
      redirect_uris: regBody.redirect_uris ?? [],
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
      res.writeHead(302, {
        Location: callback.toString(),
        "Set-Cookie": `pl_key=${api_key}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`,
      });
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
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(renderDashboard());
  }

  if (path === "/api/health") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ status: "ok", providers: getHealthData() }));
  }

  if (path === "/api/providers") return providersHandler(fakeReq, fakeRes);
  if (path === "/api/query") return queryHandler(fakeReq, fakeRes);
  if (path === "/api/mcp") return mcpHandler(fakeReq, fakeRes);
  if (path === "/api/usage") return usageHandler(fakeReq, fakeRes);

  // ── Admin API ────────────────────────────────────────────────────────────
  const adminPass = process.env.ADMIN_PASSWORD || "mantis-shrimp";
  const checkAdmin = () => req.headers["x-admin-pass"] === adminPass;

  if (path === "/api/admin/accounts" && req.method === "GET") {
    if (!checkAdmin()) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Invalid admin password" }));
    }
    const accounts = await getAllAccounts();
    const withUsage = await Promise.all(accounts.map(async (a) => {
      const breakdown = await getUsage(a.id);
      const used = breakdown.reduce((sum, r) => sum + r.count, 0);
      return {
        key: a.pl_key,
        email: a.email,
        tier: a.tier,
        quota: a.monthly_quota,
        used,
        remaining: Math.max(0, a.monthly_quota - used),
        perMinuteRate: a.per_minute_rate,
        createdAt: a.created_at,
      };
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ accounts: withUsage }));
  }

  if (path === "/api/admin/keys" && req.method === "POST") {
    if (!checkAdmin()) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Invalid admin password" }));
    }
    const plKey = "pl_" + crypto.randomBytes(12).toString("hex");
    const account = await createAccount({
      plKey,
      email: body.email,
      tier: body.tier,
      monthlyQuota: body.monthly_quota ? Number(body.monthly_quota) : undefined,
      perMinuteRate: body.per_minute_rate ? Number(body.per_minute_rate) : undefined,
    });
    if (!account) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Failed to create account" }));
    }
    res.writeHead(201, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ account: { key: account.pl_key, email: account.email, tier: account.tier, quota: account.monthly_quota, perMinuteRate: account.per_minute_rate } }));
  }

  // ── Public signup ─────────────────────────────────────────────────────────
  if (path === "/api/signup" && req.method === "POST") {
    const email = (body.email || "").trim();
    if (!email || !email.includes("@")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Valid email is required" }));
    }
    const plKey = "pl_" + crypto.randomBytes(12).toString("hex");
    const account = await createAccount({ plKey, email });
    if (!account) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Failed to create account" }));
    }
    res.writeHead(201, {
      "Content-Type": "application/json",
      "Set-Cookie": `pl_key=${plKey}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`,
    });
    return res.end(JSON.stringify({ key: plKey, tier: account.tier, quota: account.monthly_quota }));
  }

  res.statusCode = 404;
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`dev server running on http://localhost:${PORT}`);
});
