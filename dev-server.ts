#!/usr/bin/env tsx
import "dotenv/config";
import http from "node:http";
import querystring from "node:querystring";
import crypto from "node:crypto";

import providersHandler from "./api/providers.js";
import queryHandler from "./api/query.js";
import usageHandler from "./api/usage.js";
import recommendHandler from "./api/recommend.js";
import { getAllProviders } from "./lib/providers/registry.js";
import { recommend, compareProviders } from "./lib/reasoning/engine.js";

import { buildApiDocs } from "./lib/docs.js";

import {
  getAccount,
  getAccountByEmail,
  getUsage,
  getAllAccounts,
  createAccount,
  addToWaitlist,
  getRoutingStats,
} from "./lib/db.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT) || 3000;

// ─── Streamable HTTP MCP ────────────────────────────────────────────────────
const mcpSessions = new Map<
  string,
  { transport: StreamableHTTPServerTransport; server: McpServer }
>();

async function createMcpSession(
  accountId: string,
): Promise<{ transport: StreamableHTTPServerTransport; server: McpServer }> {
  const server = new McpServer({ name: "invariant", version: "0.1.0" });

  server.tool(
    "list_providers",
    "Browse all available API providers. Optionally filter by category.",
    { category: z.string().optional() },
    async ({ category }) => {
      let providers = getAllProviders();
      if (category)
        providers = providers.filter((p) => p.info.category === category);
      if (providers.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No providers found${category ? ` for category: ${category}` : ""}.`,
            },
          ],
        };
      }
      const lines = providers.map((p) => {
        const actions = p.info.availableActions
          .map((a) => {
            const paramStr = Object.entries(a.parameters)
              .map(
                ([k, v]) =>
                  `${k} (${(v as any).type}${(v as any).required ? ", required" : ""})`,
              )
              .join(", ");
            return `    - ${a.action}: ${a.description} [${paramStr}]`;
          })
          .join("\n");
        return [
          `## ${p.info.name} (${p.info.id})`,
          `Category: ${p.info.category}`,
          `Status: ${p.isAvailable() ? "Ready" : "Not configured"}`,
          `Description: ${p.info.description}`,
          `Actions:\n${actions}`,
        ].join("\n");
      });
      return { content: [{ type: "text", text: lines.join("\n\n---\n\n") }] };
    },
  );

  server.tool(
    "get_api_docs",
    "View the full API integration documentation: authentication, available REST endpoints, provider categories, and example requests. Read this before building an integration.",
    {
      section: z
        .enum(["overview", "authentication", "endpoints", "providers"])
        .optional()
        .describe(
          "Narrow to a specific section (optional; omit for full docs)",
        ),
    },
    async ({ section }) => {
      const docs = buildApiDocs(section);
      return { content: [{ type: "text", text: docs }] };
    },
  );

  server.tool(
    "recommend",
    "Get intelligent recommendations for which API provider to use based on your needs. Compares pricing, rate limits, reliability, and capabilities. Use this before querying to pick the best provider.",
    {
      need: z
        .string()
        .describe(
          "Describe what you need. e.g. 'I need real-time stock prices' or 'cheapest way to do sentiment analysis'",
        ),
      priorities: z
        .array(
          z.enum(["cost", "reliability", "speed", "data-quality", "no-auth"]),
        )
        .optional()
        .describe("What matters most to you"),
      budget: z
        .enum(["free", "low", "any"])
        .optional()
        .describe("Budget constraint"),
    },
    async ({ need, priorities, budget }) => {
      const results = recommend({ need, priorities, budget });
      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No matching providers found for that need. Try rephrasing or use list_providers to browse all available APIs.",
            },
          ],
        };
      }
      const text = results
        .map((r, i) =>
          [
            `## ${i + 1}. ${r.provider_name} (${r.provider_id}) · Score: ${r.score}/100`,
            `${r.reasoning}`,
            `Actions: ${r.actions.join(", ")}`,
            `Pricing: ${r.pricing.model}${r.pricing.freeTier ? ` (free tier: ${r.pricing.freeTier})` : ""}`,
            `Rate limits: ${r.rateLimits.free || "N/A"}`,
            `Available: ${r.available ? "✅ Ready" : "❌ Needs API key"}`,
          ].join("\n"),
        )
        .join("\n\n---\n\n");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "compare",
    "Compare two or more providers side by side on pricing, rate limits, strengths, weaknesses, and capabilities.",
    {
      provider_ids: z
        .array(z.string())
        .min(2)
        .describe("Provider IDs to compare. e.g. ['claude', 'gemini']"),
    },
    async ({ provider_ids }) => {
      const results = compareProviders(provider_ids);
      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No matching providers found. Use list_providers to see valid IDs.",
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) mcpSessions.delete(sid);
  };

  await server.connect(transport);

  return { transport, server };
}

// ─── OAuth 2.0 ──────────────────────────────────────────────────────────────

type PendingCode = {
  apiKey: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
};
const pendingCodes = new Map<string, PendingCode>();
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of pendingCodes)
    if (data.expiresAt < now) pendingCodes.delete(code);
}, 60_000);

function getBaseUrl(req: http.IncomingMessage): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  return `${proto}://${req.headers.host || `localhost:${PORT}`}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function verifyPKCE(verifier: string, challenge: string): boolean {
  const hash = crypto.createHash("sha256").update(verifier).digest("base64url");
  return hash === challenge;
}

function parseFormBody(
  req: http.IncomingMessage,
): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      const parsed = querystring.parse(data);
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed))
        result[k] = Array.isArray(v) ? v[0]! : (v ?? "");
      resolve(result);
    });
  });
}

function renderAuthorizeForm(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  error?: string;
}): string {
  const {
    clientId,
    redirectUri,
    state,
    codeChallenge,
    codeChallengeMethod,
    error,
  } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invariant | Connect</title>
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
  <h1>Invariant</h1>
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
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

function makeRes(res: http.ServerResponse) {
  const r: any = res;
  const originalEnd = res.end.bind(res);
  r.status = (code: number) => {
    res.statusCode = code;
    return r;
  };
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
        name: k,
        type: v.type,
        required: v.required,
        description: v.description,
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
  education: { label: "Education", icon: "E" },
  creative: { label: "Creative", icon: "C" },
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

const SHARED_HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Invariant - one key unlocks every API your agent needs.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Invariant">
<meta property="og:title" content="Invariant">
<meta property="og:description" content="One key unlocks every API your agent needs.">
<meta property="og:url" content="https://pclabs.dev">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Invariant">
<meta name="twitter:description" content="One key unlocks every API your agent needs.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist+Mono:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet">`;

const SHARED_STYLES = `
  *{margin:0;padding:0;box-sizing:border-box;border-radius:0 !important;}
  :root{
    --bg:#060606;
    --fg:#f2ede1;
    --muted:#6a6a66;
    --dim:#38342c;
    --amber:#ffb727;
    --cyan:#5fd3ff;
    --red:#ff3b14;
    --cream:#f2ede1;
    --line:rgba(242,237,225,0.12);
    --line-strong:rgba(242,237,225,0.28);
    --serif:'Instrument Serif','Times New Roman',serif;
    --mono:'Geist Mono','JetBrains Mono','Courier New',monospace;
    --sans:'Space Grotesk','Helvetica Neue',sans-serif;
  }
  html,body{overflow-x:hidden;}
  body{font-family:var(--mono);background:var(--bg);color:var(--fg);line-height:1.5;-webkit-font-smoothing:antialiased;min-height:100vh;
    background-image:
      linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px),
      radial-gradient(circle at 80% -10%, rgba(255,183,39,0.06), transparent 45%),
      radial-gradient(circle at 0% 110%, rgba(95,211,255,0.05), transparent 45%);
    background-size:48px 48px,48px 48px,100% 100%,100% 100%;
  }
  ::selection{background:var(--amber);color:#000;}
  a{color:var(--fg);text-decoration:none;transition:color .18s ease, background .18s ease}
  a:hover{color:var(--amber)}
  .container{max-width:1440px;margin:0 auto;padding:0 3rem;}
  @media(max-width:900px){.container{padding:0 1.25rem;}}

  /* ── nav ── */
  nav{border-bottom:2px solid var(--fg);padding:1rem 0;position:sticky;top:0;z-index:50;background:rgba(6,6,6,0.94);backdrop-filter:blur(10px);}
  nav .container{display:flex;justify-content:space-between;align-items:center;gap:2rem;}
  nav .logo{font-family:var(--mono);font-weight:700;color:var(--fg);font-size:1.1rem;letter-spacing:-0.04em;text-transform:uppercase;display:flex;align-items:center;gap:0.6rem;}
  nav .logo::before{content:'';display:inline-block;width:14px;height:14px;background:var(--amber);animation:pulse 1.6s ease-in-out infinite;}
  nav .links{display:flex;gap:2.25rem;font-size:0.8rem;font-weight:500;text-transform:uppercase;letter-spacing:0.08em;}
  nav .links a{color:var(--muted);position:relative;padding:0.25rem 0;}
  nav .links a::after{content:'';position:absolute;left:0;bottom:-4px;width:0;height:2px;background:var(--amber);transition:width .25s ease;}
  nav .links a:hover, nav .links a.active{color:var(--fg);}
  nav .links a:hover::after, nav .links a.active::after{width:100%;}

  @keyframes pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:0.4;transform:scale(0.7);}}
  @keyframes marquee{0%{transform:translateX(0);}100%{transform:translateX(-50%);}}
  @keyframes rise{0%{opacity:0;transform:translateY(40px);}100%{opacity:1;transform:translateY(0);}}
  @keyframes slide-in-left{0%{opacity:0;transform:translateX(-80px);}100%{opacity:1;transform:translateX(0);}}
  @keyframes slide-in-right{0%{opacity:0;transform:translateX(80px);}100%{opacity:1;transform:translateX(0);}}
  @keyframes flicker{0%,100%{opacity:1;}45%{opacity:1;}46%{opacity:0.4;}47%{opacity:1;}70%{opacity:0.8;}71%{opacity:1;}}
  @keyframes glitch{0%,100%{transform:translate(0);}20%{transform:translate(-2px,1px);}40%{transform:translate(2px,-1px);}60%{transform:translate(-1px,-1px);}80%{transform:translate(1px,2px);}}
  @keyframes sweep{0%{transform:translateX(-100%);}100%{transform:translateX(100%);}}
  @keyframes blink-caret{0%,50%{opacity:1;}51%,100%{opacity:0;}}

  /* ── brutalist buttons ── */
  .btn{display:inline-flex;align-items:center;justify-content:center;padding:0.95rem 2rem;font-family:var(--mono);font-size:0.85rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;transition:all .2s ease;cursor:pointer;border:2px solid var(--fg);text-decoration:none;position:relative;overflow:hidden;}
  .btn-primary{background:var(--fg);color:#000;}
  .btn-primary:hover{background:var(--amber);border-color:var(--amber);color:#000;transform:translate(-3px,-3px);box-shadow:6px 6px 0 var(--fg);}
  .btn-ghost{background:transparent;color:var(--fg);}
  .btn-ghost:hover{background:var(--fg);color:#000;transform:translate(-3px,-3px);box-shadow:6px 6px 0 var(--amber);}

  .page-footer{border-top:2px solid var(--fg);padding:3rem 0;margin-top:5rem;display:flex;justify-content:space-between;font-size:0.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;}
`;

function renderNav(active?: string): string {
  return `<nav><div class="container">
    <a href="/" class="logo">INVARIANT</a>
    <div class="links">
      <a href="/how-it-works"${active === "how" ? ' class="active"' : ""}>HOW IT WORKS</a>
      <a href="/login"${active === "login" ? ' class="active"' : ""}>LOGIN</a>
    </div>
  </div></nav>`;
}

function renderHomepage(): string {
  const providers = getHealthData();
  const total = providers.length;
  const live = providers.filter((p) => p.available).length;
  const categories = Object.keys(CATEGORY_META);

  const categoryList = categories
    .map((cat) => {
      const meta = CATEGORY_META[cat] || { label: cat, icon: "·" };
      const count = providers.filter((p) => p.category === cat).length;
      return `<span class="cat-tag">${escapeHtml(meta.label.toLowerCase())} (${count})</span>`;
    })
    .join("");

  const grouped: Record<string, typeof providers> = {};
  for (const p of providers) {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  }

  let idx = 0;
  const providerGrid = Object.entries(grouped)
    .map(([cat, provs]) => {
      const meta = CATEGORY_META[cat] || { label: cat, icon: "·" };
      const cards = provs
        .map((p) => {
          idx++;
          const badge = p.available
            ? `<span class="pg-badge pg-live">live</span>`
            : `<span class="pg-badge pg-nokey">key needed</span>`;
          const actionCount = p.actions.length;
          return `<div class="pg-card" style="animation-delay:${idx * 0.06}s">
            <div class="pg-card-top">
              <span class="pg-num">${String(idx).padStart(2, "0")}</span>
              ${badge}
            </div>
            <h4 class="pg-name">${escapeHtml(p.name)}</h4>
            <p class="pg-desc">${escapeHtml(p.description)}</p>
            <div class="pg-card-foot">
              <span class="pg-id">${escapeHtml(p.id)}</span>
              <span class="pg-actions">${actionCount} action${actionCount !== 1 ? "s" : ""}</span>
            </div>
          </div>`;
        })
        .join("");
      return `<div class="pg-group">
        <div class="pg-group-head">
          <span class="pg-icon">${escapeHtml(meta.icon)}</span>
          <span class="pg-label">${escapeHtml(meta.label)}</span>
          <span class="pg-line"></span>
          <span class="pg-count">${provs.length}</span>
        </div>
        <div class="pg-cards">${cards}</div>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD}
<title>Invariant</title>
<style>
${SHARED_STYLES}

  /* ── ticker marquee ── */
  .ticker{border-bottom:2px solid var(--fg);background:#0a0a0a;overflow:hidden;padding:0.65rem 0;white-space:nowrap;font-family:var(--mono);font-size:0.75rem;letter-spacing:0.22em;text-transform:uppercase;color:var(--muted);}
  .ticker-track{display:inline-flex;animation:marquee 38s linear infinite;will-change:transform;}
  .ticker span{display:inline-block;padding:0 2.25rem;}
  .ticker span::before{content:'◆';color:var(--amber);margin-right:2.25rem;}

  /* ── HERO ── */
  .hero-wrap{position:relative;padding:4rem 0 2rem;min-height:calc(100vh - 96px);}
  .hero-wrap::before{content:'';position:absolute;inset:0;background-image:radial-gradient(circle at 85% 15%, rgba(255,183,39,0.08), transparent 40%);pointer-events:none;}
  .hero-grid{display:grid;grid-template-columns:1.35fr 0.75fr;gap:3.5rem;align-items:start;position:relative;z-index:1;}
  .hero-left{padding-right:0;}
  .kicker{display:inline-flex;align-items:center;gap:0.85rem;font-family:var(--mono);font-size:0.72rem;letter-spacing:0.2em;text-transform:uppercase;color:var(--amber);margin-bottom:2rem;border:2px solid var(--amber);padding:0.55rem 1rem;animation:rise 0.8s ease both;}
  .kicker .pulse-dot{display:inline-block;width:9px;height:9px;background:var(--amber);animation:pulse 1.4s ease-in-out infinite;}

  h1.hero-display{
    font-family:var(--serif);
    font-size:clamp(3.6rem, 9.5vw, 10.5rem);
    font-weight:400;
    line-height:0.88;
    letter-spacing:-0.035em;
    color:var(--fg);
    margin:0 0 1.75rem;
    animation:rise 0.95s 0.1s ease both;
  }
  h1.hero-display .ital{font-style:italic;color:var(--amber);display:inline-block;position:relative;}
  h1.hero-display .ital::after{content:'';position:absolute;left:-0.1em;right:-0.05em;bottom:0.12em;height:0.1em;background:var(--amber);opacity:0.35;transform-origin:left center;animation:draw-in 0.7s 1.5s cubic-bezier(.3,.8,.3,1) both;}
  @keyframes draw-in{0%{transform:scaleX(0);}100%{transform:scaleX(1);}}
  h1.hero-display .strike{position:relative;color:#8a8578;}
  h1.hero-display .strike::after{content:'';position:absolute;left:-0.04em;right:-0.04em;top:52%;height:0.14em;background:var(--red);transform:skew(-14deg) scaleX(0);transform-origin:left center;animation:strike-in 0.55s 1.1s cubic-bezier(.3,.8,.3,1) both;}
  @keyframes strike-in{0%{transform:skew(-14deg) scaleX(0);}100%{transform:skew(-14deg) scaleX(1);}}
  h1.hero-display .block{display:block;}
  h1.hero-display .mono{font-family:var(--mono);font-size:0.55em;letter-spacing:-0.02em;vertical-align:0.25em;color:var(--cyan);}

  .hero-sub{
    font-family:var(--sans);
    font-size:clamp(1.05rem, 1.55vw, 1.4rem);
    line-height:1.45;
    color:#b4ae9f;
    max-width:640px;
    margin:2rem 0 0;
    animation:rise 0.95s 0.25s ease both;
  }
  .hero-sub strong{color:var(--fg);font-weight:600;background:linear-gradient(transparent 62%, rgba(255,183,39,0.35) 62%);padding:0 2px;}

  .hero-meta{display:flex;gap:2.5rem;font-family:var(--mono);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.12em;color:var(--muted);margin-top:3rem;animation:rise 0.95s 0.45s ease both;flex-wrap:wrap;}
  .hero-meta span::before{content:'> ';color:var(--cyan);}
  .hero-meta span:hover{color:var(--fg);}

  .hero-right{position:relative;padding-top:2rem;animation:slide-in-right 1s 0.3s ease both;}
  .ascii-box{font-family:var(--mono);font-size:0.72rem;line-height:1.2;color:var(--fg);white-space:pre;user-select:none;border:2px solid var(--fg);padding:1.4rem 1.1rem;background:#0a0a0a;box-shadow:-9px 9px 0 var(--amber);position:relative;animation:flicker 6s ease-in-out infinite;}
  .ascii-box::before{content:'ASCII.TERMINAL // v0.1';position:absolute;top:-10px;left:1rem;background:var(--bg);padding:0 0.5rem;font-size:0.6rem;color:var(--amber);letter-spacing:0.18em;font-weight:600;}
  .status-card{border:2px solid var(--fg);padding:1.25rem 1.35rem;margin-top:2.5rem;background:#0a0a0a;font-family:var(--mono);font-size:0.75rem;color:var(--muted);display:grid;grid-template-columns:auto 1fr;gap:0.5rem 1.25rem;box-shadow:-6px 6px 0 var(--cyan);animation:rise 0.9s 0.6s ease both;}
  .status-card .k{color:var(--muted);text-transform:uppercase;letter-spacing:0.12em;font-size:0.65rem;}
  .status-card .v{color:var(--fg);font-weight:600;font-size:0.78rem;}
  .status-card .v.live{color:var(--amber);}
  .status-card .v.live::before{content:'● ';animation:pulse 1.4s ease-in-out infinite;}

  /* ── WAITLIST ── */
  .waitlist-hero{max-width:620px;margin-top:3rem;animation:rise 0.95s 0.55s ease both;}
  .waitlist-hero .wl-label{font-family:var(--mono);font-size:0.72rem;letter-spacing:0.18em;text-transform:uppercase;color:var(--amber);margin-bottom:0.95rem;display:flex;align-items:center;gap:0.75rem;}
  .waitlist-hero .wl-label::before{content:'';width:42px;height:2px;background:var(--amber);}
  .waitlist-hero form{display:flex;gap:0;border:2px solid var(--fg);background:#0a0a0a;transition:box-shadow 0.2s, transform 0.2s;}
  .waitlist-hero form:focus-within{box-shadow:-8px 8px 0 var(--amber);transform:translate(-2px,-2px);}
  .waitlist-hero input[type="email"]{flex:1;padding:1.1rem 1.25rem;background:transparent;border:none;border-right:2px solid var(--fg);color:var(--fg);font-size:0.95rem;outline:none;font-family:var(--mono);}
  .waitlist-hero input[type="email"]::placeholder{color:#55524a;}
  .waitlist-hero .btn-wait{padding:1.1rem 1.9rem;background:var(--fg);color:#000;border:none;font-size:0.8rem;font-weight:700;cursor:pointer;text-transform:uppercase;letter-spacing:0.14em;font-family:var(--mono);transition:background 0.2s;}
  .waitlist-hero .btn-wait:hover{background:var(--amber);}
  .waitlist-hero .msg{font-size:0.75rem;margin-top:1rem;min-height:1.2em;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;font-family:var(--mono);}
  .waitlist-hero .msg.ok{color:var(--amber);}
  .waitlist-hero .msg.err{color:var(--red);}

  /* ── STATS STRIP ── */
  .stats-strip{border-top:2px solid var(--fg);border-bottom:2px solid var(--fg);margin:5rem 0 6rem;background:#0a0a0a;display:grid;grid-template-columns:repeat(4,1fr);position:relative;}
  .stats-strip::after{content:'';position:absolute;left:0;bottom:-2px;height:2px;width:60%;background:linear-gradient(90deg, var(--amber), var(--cyan), var(--amber));animation:sweep 5s ease-in-out infinite;}
  .stats-strip .s{padding:2.75rem 1.75rem 2rem;border-right:2px solid var(--fg);position:relative;transition:background 0.3s, color 0.3s;cursor:default;}
  .stats-strip .s:last-child{border-right:none;}
  .stats-strip .s:hover{background:var(--fg);}
  .stats-strip .s:hover .sv{color:#000;}
  .stats-strip .s:hover .sv .unit{color:var(--red);}
  .stats-strip .s:hover .sl{color:#333;}
  .stats-strip .sv{font-family:var(--serif);font-size:clamp(3.2rem,6vw,5.8rem);font-weight:400;color:var(--fg);line-height:0.92;font-variant-numeric:tabular-nums;letter-spacing:-0.045em;transition:color 0.3s;}
  .stats-strip .sv .unit{font-size:0.42em;color:var(--amber);margin-left:0.12em;font-family:var(--mono);font-weight:500;vertical-align:0.45em;transition:color 0.3s;}
  .stats-strip .sl{font-family:var(--mono);font-size:0.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.16em;margin-top:1rem;font-weight:500;transition:color 0.3s;}
  .stats-strip .s::before{content:attr(data-num);position:absolute;top:0.75rem;right:0.85rem;font-family:var(--mono);font-size:0.62rem;color:#3a362d;letter-spacing:0.15em;}

  /* ── GAME SECTION ── */
  .game-section{display:grid;grid-template-columns:0.8fr 2.2fr;gap:3rem;align-items:center;margin:5rem 0;padding:3rem 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);}
  .game-label{padding-left:0;}
  .game-label .eyebrow{font-family:var(--mono);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.22em;color:var(--amber);margin-bottom:1.25rem;display:inline-block;border:2px solid var(--amber);padding:0.45rem 0.8rem;}
  .game-label h2{font-family:var(--serif);font-size:clamp(2.4rem,4.5vw,3.8rem);line-height:0.92;color:var(--fg);margin-bottom:1.25rem;font-style:italic;letter-spacing:-0.025em;}
  .game-label h2 .num{font-style:normal;color:var(--amber);font-family:var(--mono);font-size:0.5em;letter-spacing:0;vertical-align:0.35em;margin-right:0.15em;}
  .game-label p{font-family:var(--mono);font-size:0.82rem;line-height:1.65;color:#8a8578;max-width:280px;}
  .game-wrap{position:relative;border:2px solid var(--fg);overflow:hidden;background:#050505;box-shadow:-10px 10px 0 var(--cyan);}
  .game-wrap::before{content:'RUN.EXE';position:absolute;top:0.75rem;left:1rem;font-family:var(--mono);font-size:0.68rem;color:var(--amber);letter-spacing:0.22em;z-index:2;font-weight:600;}
  .game-wrap::after{content:'◆ AUTO-PILOT';position:absolute;top:0.75rem;right:1rem;font-family:var(--mono);font-size:0.68rem;color:var(--muted);letter-spacing:0.15em;z-index:2;animation:flicker 3.5s ease-in-out infinite;}
  .game-canvas{font-family:var(--mono);font-size:0.92rem;line-height:1.12;color:var(--cream);white-space:pre;padding:2.5rem 1.25rem 1.5rem;overflow:hidden;}
  #game-display{width:100%;}

  /* ── PITCH SPLIT ── */
  .pitch-split{display:grid;grid-template-columns:1fr 1.05fr;gap:5rem;margin:7rem 0;align-items:start;}
  .pitch-split .ps-left .eye{font-family:var(--mono);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.2em;color:var(--cyan);margin-bottom:1.25rem;display:block;}
  .pitch-split .ps-left h2{font-family:var(--serif);font-size:clamp(2.4rem,5vw,4.4rem);line-height:0.92;color:var(--fg);letter-spacing:-0.025em;}
  .pitch-split .ps-left h2 em{color:var(--amber);}
  .pitch-split .ps-right{font-family:var(--sans);font-size:1.1rem;line-height:1.65;color:#b4ae9f;padding-top:0.75rem;}
  .pitch-split .ps-right p+p{margin-top:1.35rem;}
  .pitch-split .ps-right strong{color:var(--fg);font-weight:600;border-bottom:1.5px solid var(--amber);}

  /* ── CATEGORIES ── */
  .categories{margin:6rem 0 5rem;padding:3rem 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);display:grid;grid-template-columns:0.65fr 2.35fr;gap:3.5rem;align-items:start;}
  .categories .cat-head{font-family:var(--mono);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.2em;color:var(--muted);}
  .categories .cat-head span{display:block;color:var(--amber);font-family:var(--serif);font-size:clamp(1.8rem,2.5vw,2.4rem);font-style:italic;text-transform:none;letter-spacing:-0.02em;margin-top:0.6rem;line-height:1;}
  .cat-tags{display:flex;flex-wrap:wrap;gap:0.55rem;}
  .cat-tag{font-family:var(--mono);font-size:0.78rem;color:var(--fg);padding:0.6rem 1.1rem;border:1.5px solid var(--line-strong);background:transparent;text-transform:uppercase;letter-spacing:0.08em;transition:all 0.2s;cursor:default;}
  .cat-tag:hover{border-color:var(--amber);color:var(--amber);background:rgba(255,183,39,0.08);transform:translate(-2px,-2px);box-shadow:3px 3px 0 var(--amber);}
  .cat-tag-more{color:var(--amber);border-style:dashed;border-color:var(--amber);}
  .cat-tag-more::before{content:'+ ';}

  /* ── PROVIDER GRID ── */
  .provider-showcase{margin:0 0 6rem;padding:4rem 0 0;}
  .ps-head{display:grid;grid-template-columns:0.65fr 2.35fr;gap:3.5rem;align-items:start;margin-bottom:3.5rem;}
  .ps-head-left{font-family:var(--mono);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.2em;color:var(--muted);}
  .ps-head-left span{display:block;color:var(--cyan);font-family:var(--serif);font-size:clamp(1.8rem,2.5vw,2.4rem);font-style:italic;text-transform:none;letter-spacing:-0.02em;margin-top:0.6rem;line-height:1;}
  .ps-head-right{font-family:var(--sans);font-size:1rem;color:#8a8578;line-height:1.55;padding-top:0.25rem;}
  .ps-head-right strong{color:var(--fg);font-weight:600;}

  .pg-group{margin-bottom:3rem;}
  .pg-group-head{display:flex;align-items:center;gap:0.85rem;margin-bottom:1.25rem;padding-bottom:0.85rem;border-bottom:1px solid var(--line);}
  .pg-icon{width:1.6rem;height:1.6rem;display:flex;align-items:center;justify-content:center;background:var(--amber);color:#000;font-family:var(--mono);font-size:0.65rem;font-weight:700;flex-shrink:0;}
  .pg-label{font-family:var(--serif);font-style:italic;font-size:1.35rem;font-weight:400;color:var(--fg);letter-spacing:-0.015em;text-transform:lowercase;}
  .pg-line{flex:1;height:1px;background:var(--line);}
  .pg-count{font-family:var(--mono);font-size:0.62rem;color:var(--amber);border:1.5px solid var(--amber);padding:0.15rem 0.5rem;text-transform:uppercase;letter-spacing:0.1em;}

  .pg-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;}
  .pg-card{background:#0a0a0a;border:1.5px solid var(--line-strong);padding:1.35rem 1.4rem 1.15rem;position:relative;transition:all .25s ease;animation:rise 0.7s ease both;}
  .pg-card:hover{border-color:var(--fg);transform:translate(-3px,-3px);box-shadow:5px 5px 0 var(--amber);}
  .pg-card-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:0.85rem;}
  .pg-num{font-family:var(--mono);font-size:0.58rem;color:#3a362d;letter-spacing:0.15em;}
  .pg-badge{font-family:var(--mono);font-size:0.52rem;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;padding:0.18rem 0.45rem;border:1.5px solid currentColor;}
  .pg-live{color:var(--amber);}
  .pg-live::before{content:'● ';font-size:0.5em;vertical-align:1px;animation:pulse 1.6s ease-in-out infinite;}
  .pg-nokey{color:var(--muted);}
  .pg-name{font-family:var(--serif);font-size:1.15rem;font-weight:400;color:var(--fg);line-height:1.15;margin-bottom:0.6rem;letter-spacing:-0.01em;}
  .pg-desc{font-family:var(--sans);font-size:0.78rem;color:#8a8578;line-height:1.5;margin-bottom:1rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  .pg-card-foot{display:flex;justify-content:space-between;align-items:center;padding-top:0.65rem;border-top:1px solid var(--line);}
  .pg-id{font-family:var(--mono);font-size:0.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;}
  .pg-actions{font-family:var(--mono);font-size:0.58rem;color:var(--cyan);text-transform:uppercase;letter-spacing:0.1em;}

  @media(max-width:1100px){.pg-cards{grid-template-columns:repeat(2,1fr);}}
  @media(max-width:640px){
    .pg-cards{grid-template-columns:1fr;}
    .ps-head{grid-template-columns:1fr;gap:1rem;}
  }

  /* ── DEMO TERMINAL ── */
  .demo-wrap{margin:6rem 0;}
  .demo-wrap-head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:1.75rem;padding-bottom:1.25rem;border-bottom:1px solid var(--line);gap:2rem;}
  .demo-wrap-head .left{font-family:var(--serif);font-size:clamp(2rem,4vw,3.4rem);font-style:italic;color:var(--fg);line-height:0.95;letter-spacing:-0.02em;}
  .demo-wrap-head .left em{font-style:normal;color:var(--amber);}
  .demo-wrap-head .right{font-family:var(--mono);font-size:0.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.14em;text-align:right;flex-shrink:0;}
  .demo-wrap-head .right::before{content:'// ';color:var(--cyan);}
  .demo-term{background:#050505;border:2px solid var(--fg);overflow:hidden;font-family:var(--mono);box-shadow:-10px 10px 0 var(--amber);}
  .demo-head{padding:0.75rem 1.25rem;background:#0a0a0a;font-size:0.72rem;color:var(--muted);border-bottom:2px solid var(--fg);display:flex;align-items:center;gap:0.95rem;text-transform:uppercase;letter-spacing:0.1em;}
  .demo-head .dots{display:flex;gap:0.42rem;}
  .demo-head .dot{width:11px;height:11px;background:var(--dim);}
  .demo-head .dot:nth-child(1){background:var(--red);}
  .demo-head .dot:nth-child(2){background:var(--amber);}
  .demo-head .dot:nth-child(3){background:var(--cyan);}
  .demo-head .meta{margin-left:auto;color:var(--muted);font-size:0.65rem;}
  .demo-body{padding:1.9rem 2.25rem;font-size:0.95rem;line-height:1.7;min-height:380px;}
  .d-line{opacity:0;transform:translateY(4px);transition:opacity 0.35s ease,transform 0.35s ease;white-space:pre-wrap;word-break:break-word;font-family:inherit;}
  .d-line.visible{opacity:1;transform:translateY(0);}
  .d-in{color:var(--fg);font-weight:500;}
  .d-sys{color:var(--cyan);}
  .d-box{color:#8a8578;}
  .d-ok{color:var(--amber);}
  .d-done{color:var(--amber);margin-top:0.85rem;font-weight:700;}
  .d-dim{color:var(--dim);}

  /* ── INSTALL ── */
  .install-wrap{display:grid;grid-template-columns:0.9fr 1.1fr;gap:3.5rem;margin:6rem 0;align-items:center;}
  .install-left h3{font-family:var(--serif);font-size:clamp(2.2rem,4vw,3.4rem);line-height:0.95;color:var(--fg);margin-bottom:1.25rem;font-style:italic;letter-spacing:-0.02em;}
  .install-left h3 em{font-style:normal;color:var(--amber);}
  .install-left p{font-family:var(--mono);font-size:0.88rem;color:#8a8578;line-height:1.7;max-width:440px;}
  .terminal{background:#0a0a0a;border:2px solid var(--fg);padding:1.75rem 2rem;font-family:var(--mono);font-size:0.88rem;line-height:1.85;box-shadow:-10px 10px 0 var(--fg);position:relative;}
  .terminal::before{content:'~/shell';position:absolute;top:-10px;left:1rem;background:var(--bg);padding:0 0.5rem;font-size:0.62rem;color:var(--amber);letter-spacing:0.15em;}
  .terminal .prompt{color:var(--amber);}
  .terminal .cmd{color:var(--fg);}
  .terminal .out{color:var(--muted);margin-top:1.1rem;border-top:1px dashed var(--line);padding-top:1.1rem;font-size:0.8rem;}
  .terminal .out::before{content:'└─ ';color:var(--cyan);}

  /* ── POPUP ── */
  .popup-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.82);z-index:1000;display:none;align-items:center;justify-content:center;backdrop-filter:blur(6px);}
  .popup-overlay.visible{display:flex;animation:rise 0.4s ease both;}
  .popup-card{background:var(--bg);border:2px solid var(--fg);padding:2.5rem 2.25rem 2.25rem;max-width:460px;width:90%;position:relative;box-shadow:-12px 12px 0 var(--amber);}
  .popup-card::before{content:'◆ LIMITED ACCESS';position:absolute;top:-11px;left:1rem;background:var(--bg);padding:0 0.55rem;font-family:var(--mono);font-size:0.65rem;color:var(--amber);letter-spacing:0.18em;font-weight:600;}
  .popup-card h3{font-family:var(--serif);font-size:2rem;color:var(--fg);margin-bottom:0.75rem;font-style:italic;line-height:0.95;}
  .popup-card h3 em{color:var(--amber);font-style:italic;}
  .popup-card p{font-family:var(--sans);font-size:0.98rem;color:#b4ae9f;margin-bottom:1.6rem;line-height:1.55;}
  .popup-card form{display:flex;gap:0;border:2px solid var(--fg);background:#0a0a0a;}
  .popup-card input[type="email"]{flex:1;padding:0.95rem 1.1rem;background:transparent;border:none;border-right:2px solid var(--fg);color:var(--fg);font-size:0.9rem;outline:none;font-family:var(--mono);}
  .popup-card .btn-wait{padding:0.95rem 1.4rem;background:var(--fg);color:#000;border:none;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.12em;transition:background 0.2s;}
  .popup-card .btn-wait:hover{background:var(--amber);}
  .popup-close{position:absolute;top:0.75rem;right:1rem;background:none;border:none;color:var(--muted);font-size:1.5rem;cursor:pointer;padding:0.25rem;line-height:1;}
  .popup-close:hover{color:var(--red);}
  .popup-card .msg{font-size:0.75rem;margin-top:0.95rem;min-height:1.2em;text-transform:uppercase;letter-spacing:0.1em;font-family:var(--mono);}
  .popup-card .msg.ok{color:var(--amber);}
  .popup-card .msg.err{color:var(--red);}

  /* ── COLLAB (LIGHT THEME) ── */
  .collab{background:#f2ede1;color:#0a0a0a;padding:6rem 0 0;position:relative;overflow:hidden;border-top:4px solid var(--fg);margin-top:7rem;}
  .collab::before{content:'TEAMS // v0.2';position:absolute;top:2rem;right:3rem;font-family:var(--mono);font-size:0.7rem;letter-spacing:0.22em;color:#0a0a0a;border:2px solid #0a0a0a;padding:0.4rem 0.75rem;font-weight:600;}
  .collab-inner{max-width:1440px;margin:0 auto;padding:0 3rem;position:relative;}
  .collab-eyebrow{display:inline-block;font-family:var(--mono);font-size:0.7rem;color:#f2ede1;background:#0a0a0a;border:2px solid #0a0a0a;padding:0.5rem 0.95rem;text-transform:uppercase;letter-spacing:0.16em;margin-bottom:1.75rem;font-weight:600;}
  .collab-header{max-width:960px;margin-bottom:5rem;}
  .collab-header h2{font-family:var(--serif);font-size:clamp(3rem,7vw,7.2rem);font-weight:400;color:#0a0a0a;letter-spacing:-0.035em;line-height:0.88;margin-bottom:1.75rem;}
  .collab-header h2 em{color:#c24600;font-style:italic;}
  .collab-header p{font-family:var(--sans);font-size:clamp(1.05rem,1.4vw,1.3rem);color:#555;max-width:700px;line-height:1.5;}
  .collab-header p strong{color:#0a0a0a;font-weight:600;background:#ffb727;padding:0 0.25em;}

  .collab-contrast{display:grid;grid-template-columns:1fr 1fr;gap:0;max-width:1240px;margin:0 0 5rem;border:2px solid #0a0a0a;}
  .collab-col{padding:2.5rem 2.25rem;background:#f7f2e4;}
  .collab-col.before{border-right:2px solid #0a0a0a;}
  .collab-col.after{background:#0a0a0a;color:#f2ede1;}
  .collab-col h3{font-family:var(--mono);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.2em;color:#888;margin-bottom:1.75rem;font-weight:600;padding-bottom:0.95rem;border-bottom:1px solid #ddd;}
  .collab-col.after h3{color:#888;border-bottom-color:#333;}
  .collab-col ul{list-style:none;padding:0;margin:0;}
  .collab-col li{font-family:var(--sans);font-size:0.98rem;line-height:1.55;padding:0.75rem 0;color:#555;display:flex;gap:0.85rem;border-bottom:1px dashed #e2dccc;}
  .collab-col li:last-child{border-bottom:none;}
  .collab-col.after li{color:#c9c4b7;border-bottom-color:#222;}
  .collab-col li::before{content:'×';color:#c24600;font-weight:700;flex-shrink:0;font-size:1.15rem;line-height:1.3;}
  .collab-col.after li::before{color:#ffb727;content:'✓';}

  .collab-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0;max-width:1240px;margin:0 0 0;border-top:2px solid #0a0a0a;border-bottom:2px solid #0a0a0a;}
  .collab-feat{padding:2.25rem 1.65rem;background:#f7f2e4;border-right:1px solid #0a0a0a;transition:background 0.25s, color 0.25s;position:relative;}
  .collab-feat:last-child{border-right:none;}
  .collab-feat:hover{background:#0a0a0a;color:#f2ede1;}
  .collab-feat:hover h4{color:#ffb727;}
  .collab-feat:hover p{color:#c9c4b7;}
  .collab-feat .num{font-family:var(--mono);font-size:0.68rem;color:#888;letter-spacing:0.18em;margin-bottom:0.85rem;display:block;}
  .collab-feat h4{font-family:var(--serif);font-size:1.55rem;color:#0a0a0a;margin-bottom:0.75rem;font-weight:400;font-style:italic;line-height:1.05;transition:color 0.25s;}
  .collab-feat p{font-family:var(--sans);font-size:0.92rem;color:#555;line-height:1.55;margin:0;transition:color 0.25s;}

  .collab-cta-wrap{display:grid;grid-template-columns:1fr 1fr;gap:4rem;max-width:1240px;margin:0;align-items:center;padding:3.5rem 0;border-bottom:2px solid #0a0a0a;}
  .collab-cta-wrap .cta-left h3{font-family:var(--serif);font-size:clamp(2.25rem,4vw,3.6rem);color:#0a0a0a;line-height:0.95;font-weight:400;font-style:italic;margin-bottom:0.85rem;letter-spacing:-0.02em;}
  .collab-cta-wrap .cta-left h3 em{color:#c24600;}
  .collab-cta-wrap .cta-left p{font-family:var(--sans);font-size:1.05rem;color:#555;line-height:1.55;max-width:460px;}
  .collab-cta form{display:flex;gap:0;border:2px solid #0a0a0a;background:#fff;}
  .collab-cta input[type="email"]{flex:1;padding:1.1rem 1.25rem;background:transparent;border:none;border-right:2px solid #0a0a0a;color:#0a0a0a;font-size:0.92rem;outline:none;font-family:var(--mono);}
  .collab-cta .btn-team{padding:1.1rem 1.6rem;background:#0a0a0a;color:#f2ede1;border:none;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.14em;transition:background 0.2s;}
  .collab-cta .btn-team:hover{background:#c24600;}
  .collab-cta .msg{font-size:0.75rem;margin-top:0.95rem;min-height:1.2em;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.1em;}
  .collab-cta .msg.ok{color:#2d6a2d;}
  .collab-cta .msg.err{color:#a02020;}
  .collab-pricing{text-align:left;font-family:var(--mono);font-size:0.72rem;color:#888;letter-spacing:0.14em;text-transform:uppercase;max-width:1240px;margin:0;padding:2rem 0;border-bottom:1px solid #ddd;}

  .collab-footer{max-width:1240px;padding:2.5rem 0;margin:0;display:flex;justify-content:space-between;font-family:var(--mono);font-size:0.75rem;color:#555;text-transform:uppercase;letter-spacing:0.12em;}
  .collab-footer a{color:#0a0a0a;text-decoration:none;border-bottom:1.5px solid #0a0a0a;padding-bottom:1px;transition:color 0.2s, border-color 0.2s;}
  .collab-footer a:hover{color:#c24600;border-bottom-color:#c24600;}

  /* ── scroll reveal ── */
  .reveal{opacity:0;transform:translateY(50px);transition:opacity 0.9s cubic-bezier(.2,.7,.2,1), transform 0.9s cubic-bezier(.2,.7,.2,1);}
  .reveal.in{opacity:1;transform:translateY(0);}

  @media(max-width:1100px){
    .hero-grid{grid-template-columns:1fr;gap:2.5rem;}
    .hero-right{padding-top:0;}
    .pitch-split{grid-template-columns:1fr;gap:2rem;}
    .install-wrap{grid-template-columns:1fr;gap:2rem;}
    .categories{grid-template-columns:1fr;gap:1.25rem;}
    .game-section{grid-template-columns:1fr;gap:1.5rem;}
    .collab-cta-wrap{grid-template-columns:1fr;gap:2rem;}
  }
  @media(max-width:900px){
    .stats-strip{grid-template-columns:repeat(2,1fr);}
    .stats-strip .s:nth-child(1),.stats-strip .s:nth-child(2){border-bottom:2px solid var(--fg);}
    .stats-strip .s:nth-child(2){border-right:none;}
    .collab-grid{grid-template-columns:1fr 1fr;}
    .collab-feat:nth-child(2){border-right:none;}
    .collab-feat:nth-child(1),.collab-feat:nth-child(2){border-bottom:1px solid #0a0a0a;}
    .collab-contrast{grid-template-columns:1fr;}
    .collab-col.before{border-right:none;border-bottom:2px solid #0a0a0a;}
    .hero-meta{gap:1.25rem;}
  }
  @media(max-width:640px){
    .hero-wrap{padding:2.5rem 0 1.5rem;min-height:auto;}
    h1.hero-display{font-size:3.4rem;}
    .stats-strip{grid-template-columns:1fr;}
    .stats-strip .s{border-right:none;border-bottom:2px solid var(--fg);}
    .stats-strip .s:last-child{border-bottom:none;}
    .waitlist-hero form{flex-direction:column;}
    .waitlist-hero input[type="email"]{border-right:none;border-bottom:2px solid var(--fg);}
    .popup-card form{flex-direction:column;}
    .popup-card input[type="email"]{border-right:none;border-bottom:2px solid var(--fg);}
    .ascii-box{font-size:0.52rem;}
    .game-canvas{font-size:0.55rem;padding:1.75rem 0.75rem 1rem;}
    .collab-inner{padding:0 1.25rem;}
    .collab-grid{grid-template-columns:1fr;}
    .collab-feat{border-right:none !important;border-bottom:1px solid #0a0a0a;}
    .collab-feat:last-child{border-bottom:none;}
    .collab::before{display:none;}
    .demo-body{font-size:0.78rem;padding:1.25rem;min-height:320px;}
    .demo-wrap-head{flex-direction:column;align-items:flex-start;gap:0.5rem;}
    .demo-wrap-head .right{text-align:left;}
  }
</style>
</head>
<body>
${renderNav()}

<div class="ticker">
  <div class="ticker-track">
    <span>one key · every api</span>
    <span>the api layer, subtracted</span>
    <span>zero .env files on your machine</span>
    <span>zero provider accounts</span>
    <span>built for agents, not humans</span>
    <span>alpha drops soon</span>
    <span>one key · every api</span>
    <span>the api layer, subtracted</span>
    <span>zero .env files on your machine</span>
    <span>zero provider accounts</span>
    <span>built for agents, not humans</span>
    <span>alpha drops soon</span>
  </div>
</div>

<div class="container">
  <div class="hero-wrap">
    <div class="hero-grid">
      <div class="hero-left">
        <div class="kicker"><span class="pulse-dot"></span>alpha · waitlist open <span class="mono" style="color:var(--cyan);">// v0.1</span></div>
        <h1 class="hero-display">
          stop <span class="strike">integrating</span><span class="block">apis.</span>
          <span class="block">start <span class="ital">shipping.</span></span>
        </h1>
        <p class="hero-sub">
          the <strong>mcp gateway your agent needs</strong>. one key unlocks every provider we've already signed up for. no raw tokens, no rate limiters, no vendor dashboards. ever.
        </p>
        <div class="waitlist-hero">
          <div class="wl-label">get the key before anyone else</div>
          <form id="waitlist-form">
            <input type="email" name="email" placeholder="you@working.hard" required>
            <button type="submit" class="btn-wait">claim →</button>
          </form>
          <div class="msg" id="waitlist-msg"></div>
        </div>
        <div class="hero-meta">
          <span>no auth hell</span>
          <span>no .env files</span>
          <span>no cron for rotation</span>
          <span>no vendor dashboards</span>
        </div>
      </div>

      <div class="hero-right">
        <div class="ascii-box">
 ┌──────────────────────────────────────────────┐
 │                                              │
 │   ╱╲      invariant         ╱╲              │
 │  ╱  ╲                     ╱  ╲             │
 │ ╱    ╲    ──────────      ╱    ╲            │
 │╱ ▓▓▓▓ ╲   api gateway    ╱ ▓▓▓▓ ╲           │
 │  ▓▓▓▓  ╲   for agents   ╱  ▓▓▓▓             │
 │                                              │
 └──────────────────────────────────────────────┘</div>
        <div class="status-card">
          <div class="k">status</div><div class="v live">gateway online</div>
          <div class="k">providers</div><div class="v">${total} wired</div>
          <div class="k">transport</div><div class="v">mcp · http</div>
          <div class="k">overhead</div><div class="v">~12ms</div>
          <div class="k">alpha cost</div><div class="v">zero</div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="container">
  <div class="stats-strip reveal">
    <div class="s" data-num="01 ▸">
      <div class="sv" data-target="${total}">0</div>
      <div class="sl">providers wired</div>
    </div>
    <div class="s" data-num="02 ▸">
      <div class="sv" data-target="${live}">0</div>
      <div class="sl">live right now</div>
    </div>
    <div class="s" data-num="03 ▸">
      <div class="sv" data-target="${categories.length}">0</div>
      <div class="sl">categories shipped</div>
    </div>
    <div class="s" data-num="04 ▸">
      <div class="sv" data-target="500">0<span class="unit">/mo</span></div>
      <div class="sl">free requests</div>
    </div>
  </div>
</div>

<div class="container">
  <div class="game-section reveal">
    <div class="game-label">
      <span class="eyebrow">run.exe // loop</span>
      <h2><span class="num">00/</span>an endless <em>auto&#8209;pilot.</em></h2>
      <p>watch the circle do what your agent should: leap the obstacles on its own while you worry about literally anything else.</p>
    </div>
    <div class="game-wrap">
      <div class="game-canvas"><div id="game-display"></div></div>
    </div>
  </div>
</div>

<div class="container">
  <div class="pitch-split reveal">
    <div class="ps-left">
      <span class="eye">// the pitch</span>
      <h2>you shouldn't be <em>the glue</em> between your agent and every vendor.</h2>
    </div>
    <div class="ps-right">
      <p>we already signed up for weather, finance, health, maps, identity, geo, and more. your ai agent just <strong>asks for data</strong>, and we fetch it.</p>
      <p>no provider accounts. no .env files. no credentials sitting on your laptop. we maintain the keys, we eat the rate limits, we deal with the vendor outages.</p>
      <p>your code shrinks. your bugs shrink. your on-call rotation shrinks.</p>
    </div>
  </div>
</div>

<div class="container">
  <div class="categories reveal">
    <div class="cat-head">online today<span>every api, one key.</span></div>
    <div class="cat-tags">${categoryList}<span class="cat-tag cat-tag-more">more coming fast</span></div>
  </div>
</div>

<div class="container">
  <div class="provider-showcase reveal">
    <div class="ps-head">
      <div class="ps-head-left">the full roster<span>what's wired.</span></div>
      <div class="ps-head-right"><strong>${total} providers</strong> across ${Object.keys(grouped).length} categories. every one of these is callable from your agent with a single key — zero vendor accounts needed.</div>
    </div>
    ${providerGrid}
  </div>
</div>

<div class="container">
  <div class="demo-wrap reveal">
    <div class="demo-wrap-head">
      <div class="left">this is what it <em>looks like.</em></div>
      <div class="right">live replay · on loop</div>
    </div>
    <div class="demo-term">
      <div class="demo-head">
        <div class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
        <span>~/claude-code</span>
        <span class="meta">invariant // mcp // v0.1</span>
      </div>
      <div class="demo-body" id="demo-body"></div>
    </div>
  </div>
</div>

<div class="container">
  <div class="install-wrap reveal">
    <div class="install-left">
      <h3>install, <em>then forget.</em></h3>
      <p>three lines in your terminal. every api we've already signed up for, handed to your agent. you never see a key again.</p>
    </div>
    <div class="terminal">
      <div><span class="prompt">$</span> <span class="cmd">claude mcp add invariant \\</span></div>
      <div><span class="cmd">    --transport http https://pclabs.dev/api/mcp \\</span></div>
      <div><span class="cmd">    --header "x-pl-key: pl_your_key"</span></div>
      <div class="out">done. restart your session to use ${total} providers.</div>
    </div>
  </div>
</div>

<section class="collab">
  <div class="collab-inner">
    <div class="collab-header">
      <span class="collab-eyebrow">◆ teams · soon</span>
      <h2>api key governance<br>for your <em>whole team.</em></h2>
      <p>the same one-key magic, extended to orgs. <strong>workspace credentials, per-seat usage, one-click rotation, instant offboarding.</strong></p>
    </div>

    <div class="collab-contrast">
      <div class="collab-col before">
        <h3>today // at most teams</h3>
        <ul>
          <li>api keys pasted into slack dms and vaults nobody maintains</li>
          <li>rotations happen by email chain and break something in prod</li>
          <li>no way to answer "who burned through our openai quota"</li>
          <li>someone leaves → scramble to rotate every credential they touched</li>
          <li>junior devs commit a .env file to github, twice a year</li>
        </ul>
      </div>
      <div class="collab-col after">
        <h3>tomorrow // with invariant teams</h3>
        <ul>
          <li>one workspace holds every credential. engineers never see raw keys</li>
          <li>each seat gets its own pl_key. admins control provider access</li>
          <li>per-seat usage and cost attribution, down to the api call</li>
          <li>rotate any credential in one click. zero downtime, nobody notices</li>
          <li>offboard a dev? revoke their seat. done. no credential hunt.</li>
        </ul>
      </div>
    </div>

    <div class="collab-grid">
      <div class="collab-feat">
        <span class="num">01 ▸</span>
        <h4>workspace credentials</h4>
        <p>your org's provider keys live in one encrypted vault. engineers pull without ever seeing raw values.</p>
      </div>
      <div class="collab-feat">
        <span class="num">02 ▸</span>
        <h4>per-seat attribution</h4>
        <p>see which engineer called which provider, when, and how much it cost. finance will love you.</p>
      </div>
      <div class="collab-feat">
        <span class="num">03 ▸</span>
        <h4>one-click rotation</h4>
        <p>rotate a leaked key in the dashboard. every seat picks up the new credential on its next call.</p>
      </div>
      <div class="collab-feat">
        <span class="num">04 ▸</span>
        <h4>instant offboarding</h4>
        <p>revoke a departing engineer's seat. access to every provider vanishes at once.</p>
      </div>
    </div>

    <div class="collab-cta-wrap">
      <div class="cta-left">
        <h3>early access <em>for teams.</em></h3>
        <p>we're talking to design partners now. drop your work email and we'll reach out when teams goes live.</p>
      </div>
      <div class="collab-cta">
        <form id="teams-form">
          <input type="email" name="email" placeholder="you@company.com" required>
          <button type="submit" class="btn-team">request →</button>
        </form>
        <div class="msg" id="teams-msg"></div>
      </div>
    </div>

    <p class="collab-pricing">◆ paid tier · generous free trial during beta · pricing at launch ◆</p>

    <footer class="collab-footer">
      <span>© invariant</span>
      <a href="https://github.com/tobasummandal/invariant">github →</a>
    </footer>
  </div>
</section>

<div class="popup-overlay" id="email-popup">
  <div class="popup-card">
    <button class="popup-close" id="popup-close" aria-label="Close">&times;</button>
    <h3>don't miss the <em>first wave.</em></h3>
    <p>we're opening to a small first cohort. drop your email. no spam, just the key when it's ready.</p>
    <form id="popup-form">
      <input type="email" name="email" placeholder="you@example.com" required>
      <button type="submit" class="btn-wait">notify →</button>
    </form>
    <div class="msg" id="popup-msg"></div>
  </div>
</div>

<script>
  // cookie check
  if (document.cookie.match(/pl_key=/)) {
    var links = document.querySelectorAll('nav .links a');
    links.forEach(function(a) { if (a.textContent === 'LOGIN') { a.href = '/dashboard'; a.textContent = 'DASHBOARD'; } });
  }

  // ── scroll reveal observer ──
  function animateCountUp(el){
    if (el.dataset.counted === '1') return;
    el.dataset.counted = '1';
    var target = parseInt(el.getAttribute('data-target'), 10);
    if (isNaN(target)) return;
    var unitSpan = el.querySelector('.unit');
    var textNode = document.createTextNode('0');
    el.textContent = '';
    el.appendChild(textNode);
    if (unitSpan) el.appendChild(unitSpan);
    var start = 0, duration = 1400, t0 = performance.now();
    function tick(now){
      var p = Math.min(1, (now - t0) / duration);
      var eased = 1 - Math.pow(1 - p, 4);
      var v = Math.round(start + (target - start) * eased);
      textNode.nodeValue = String(v);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  (function(){
    var els = document.querySelectorAll('.reveal');
    function revealEl(el){
      el.classList.add('in');
      if (el.classList.contains('stats-strip')){
        el.querySelectorAll('.sv[data-target]').forEach(animateCountUp);
      }
    }
    if (!('IntersectionObserver' in window)) {
      els.forEach(revealEl);
      return;
    }
    var obs = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting){
          revealEl(e.target);
          obs.unobserve(e.target);
        }
      });
    }, {threshold: 0.05, rootMargin: '0px 0px 200px 0px'});
    els.forEach(function(el){ obs.observe(el); });
    // safety net: after 1.5s, force-reveal anything still hidden so no content stays invisible
    setTimeout(function(){
      document.querySelectorAll('.reveal:not(.in)').forEach(revealEl);
    }, 1500);
  })();

  // ── ascii game (sphere auto-jumping over mountains) ──
  (function() {
    var W = 110, H = 11;
    var sphereX = 18;
    var jumping = false;
    var jumpProgress = 0;
    var scrollOffset = 0;
    var scrollSpeed = 0.5;

    // precomputed 26-frame sine jump arc, apex height 5 cells
    var JUMP_FRAMES = 26;
    var JUMP_HEIGHT = 5;
    var jumpArc = [];
    for (var i = 0; i < JUMP_FRAMES; i++) {
      jumpArc.push(-Math.sin(i / JUMP_FRAMES * Math.PI) * JUMP_HEIGHT);
    }

    var colors = ['#f2ede1','#f2ede1','#f2ede1','#ffb727','#5fd3ff','#ff3b14','#f2ede1'];
    var currentColor = '#f2ede1';
    var flashTimer = 0;

    // 4-row mountains, 8-cell bases, gaps wide enough for jump-to-land cycle
    var mountainPattern = [
      '         /\\\\                            /\\\\                        /\\\\                               /\\\\          ',
      '        /  \\\\                          /  \\\\                      /  \\\\                             /  \\\\         ',
      '       /    \\\\                        /    \\\\                    /    \\\\                           /    \\\\        ',
      '______/______\\\\______________________/______\\\\__________________/______\\\\_________________________/______\\\\_______',
    ];
    var patternW = mountainPattern[0].length;
    var groundStart = H - mountainPattern.length - 1; // top row of mountain block
    var baseSphereRow = groundStart + mountainPattern.length - 2; // row just above ground line

    function mountainAhead(offset) {
      var worldX = Math.floor(sphereX + offset + scrollOffset) % patternW;
      if (worldX < 0) worldX += patternW;
      for (var row = 0; row < mountainPattern.length; row++) {
        var c = mountainPattern[row].charAt(worldX);
        if (c && c !== ' ' && c !== '_') return true;
      }
      return false;
    }

    function tick() {
      scrollOffset += scrollSpeed;

      // detect upcoming mountain — trigger so apex lines up with peak passing sphereX
      if (!jumping) {
        if (mountainAhead(4) || mountainAhead(5) || mountainAhead(6)) {
          jumping = true;
          jumpProgress = 0;
        }
      }

      var sphereY = 0;
      if (jumping) {
        sphereY = jumpArc[jumpProgress];
        jumpProgress++;
        if (jumpProgress >= JUMP_FRAMES) {
          jumping = false;
          sphereY = 0;
        }
      }

      flashTimer--;
      if (flashTimer <= 0 && Math.random() < 0.03) {
        currentColor = colors[Math.floor(Math.random() * colors.length)];
        flashTimer = 6 + Math.floor(Math.random() * 12);
      }
      if (flashTimer <= 0) currentColor = '#f2ede1';

      render(sphereY);
      requestAnimationFrame(tick);
    }

    function render(sphereY) {
      var grid = [];
      for (var y = 0; y < H; y++) {
        grid[y] = [];
        for (var x = 0; x < W; x++) grid[y][x] = ' ';
      }

      // mountains
      for (var my = 0; my < mountainPattern.length; my++) {
        for (var x = 0; x < W; x++) {
          var srcX = Math.floor((x + scrollOffset) % patternW);
          if (srcX < 0) srcX += patternW;
          var ch = mountainPattern[my].charAt(srcX) || ' ';
          var gy = groundStart + my;
          if (gy < H) grid[gy][x] = ch;
        }
      }

      // sphere
      var sy = baseSphereRow + Math.round(sphereY);
      if (sy >= 0 && sy < H) grid[sy][sphereX] = 'O';

      var el = document.getElementById('game-display');
      if (!el) return;
      while (el.firstChild) el.removeChild(el.firstChild);

      for (var i = 0; i < H; i++) {
        var line = grid[i].join('');
        var si = line.indexOf('O');
        if (si !== -1) {
          el.appendChild(document.createTextNode(line.substring(0, si)));
          var span = document.createElement('span');
          span.style.color = currentColor;
          span.style.fontWeight = 'bold';
          span.style.textShadow = '0 0 10px ' + currentColor;
          span.textContent = 'O';
          el.appendChild(span);
          el.appendChild(document.createTextNode(line.substring(si + 1)));
        } else {
          el.appendChild(document.createTextNode(line));
        }
        el.appendChild(document.createTextNode('\\n'));
      }
    }

    tick();
  })();

  // ── count-up stats (triggered on scroll into view) ──
  (function() {
    function animateStat(el) {
      var target = parseInt(el.getAttribute('data-target') || '0', 10);
      var hasUnit = !!el.querySelector('.unit');
      // ensure first child is a text node holding the number, unit span (if any) stays after
      if (hasUnit) {
        if (!el.firstChild || el.firstChild.nodeType !== 3) {
          el.insertBefore(document.createTextNode('0'), el.firstChild);
        } else {
          el.firstChild.nodeValue = '0';
        }
      } else {
        el.textContent = '0';
      }
      var duration = 1500;
      var t0 = null;
      function frame(ts) {
        if (!t0) t0 = ts;
        var p = Math.min((ts - t0) / duration, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        var val = Math.floor(target * eased).toString();
        if (hasUnit) el.firstChild.nodeValue = val;
        else el.textContent = val;
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    function observe(selector) {
      var row = document.querySelector(selector);
      if (!row) return;
      var stats = row.querySelectorAll('.sv[data-target]');
      if (!('IntersectionObserver' in window)) {
        stats.forEach(animateStat);
        return;
      }
      var obs = new IntersectionObserver(function(entries) {
        if (entries[0].isIntersecting) {
          stats.forEach(animateStat);
          obs.disconnect();
        }
      }, {threshold: 0.3});
      obs.observe(row);
    }
    observe('.stats-row');
  })();

  // ── demo terminal animation ──
  (function() {
    var el = document.getElementById('demo-body');
    if (!el) return;

    var seq = [
      {cls:'d-in',   text:'$ claude "build a market pulse dashboard with btc price, nyc weather, and any recent fda drug recalls"', wait: 1400},
      {cls:'d-dim',  text:'', wait: 200},
      {cls:'d-sys',  text:'→ routing through invariant (mcp)...', wait: 550},
      {cls:'d-box',  text:'  ┌─ pl gateway ──────────────────────┐', wait: 280},
      {cls:'d-box',  text:'  │  fetching coingecko      → 200 ok │', wait: 380},
      {cls:'d-box',  text:'  │  fetching openweather    → 200 ok │', wait: 340},
      {cls:'d-box',  text:'  │  fetching openfda        → 200 ok │', wait: 380},
      {cls:'d-box',  text:'  └───────────────────────────────────┘', wait: 420},
      {cls:'d-sys',  text:'← 3 providers. 0 credentials managed by you.', wait: 850},
      {cls:'d-ok',   text:'✓ writing Dashboard.tsx', wait: 220},
      {cls:'d-ok',   text:'✓ writing BitcoinCard.tsx', wait: 220},
      {cls:'d-ok',   text:'✓ writing WeatherCard.tsx', wait: 220},
      {cls:'d-ok',   text:'✓ writing RecallAlert.tsx', wait: 320},
      {cls:'d-done', text:'→ done. your agent just built an app using 3 apis it never saw.', wait: 3400},
    ];

    var idx = 0;
    function step() {
      if (idx >= seq.length) {
        // fade out and restart
        var kids = el.children;
        for (var i = 0; i < kids.length; i++) kids[i].classList.remove('visible');
        setTimeout(function() {
          while (el.firstChild) el.removeChild(el.firstChild);
          idx = 0;
          step();
        }, 600);
        return;
      }
      var line = seq[idx];
      var div = document.createElement('div');
      div.className = 'd-line ' + line.cls;
      div.textContent = line.text || '\\u00a0';
      el.appendChild(div);
      // force reflow so transition runs
      void div.offsetWidth;
      div.classList.add('visible');
      idx++;
      setTimeout(step, line.wait);
    }
    step();
  })();

  // ── waitlist form handler ──
  function handleWaitlist(formId, msgId) {
    document.getElementById(formId).addEventListener('submit', async function(e) {
      e.preventDefault();
      var msg = document.getElementById(msgId);
      var btn = this.querySelector('.btn-wait');
      var email = this.email.value.trim();
      btn.disabled = true;
      btn.textContent = '...';
      try {
        var r = await fetch('/api/waitlist', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({email: email})
        });
        if (r.ok) {
          msg.className = 'msg ok';
          msg.textContent = "you're in. we'll reach out soon.";
          btn.textContent = 'done';
          window.__waitlistDone = true;
        } else {
          var d = await r.json();
          msg.className = 'msg err';
          msg.textContent = d.error || 'something went wrong';
          btn.textContent = 'join waitlist';
          btn.disabled = false;
        }
      } catch(err) {
        msg.className = 'msg err';
        msg.textContent = 'network error. try again';
        btn.textContent = 'join waitlist';
        btn.disabled = false;
      }
    });
  }
  handleWaitlist('waitlist-form', 'waitlist-msg');
  handleWaitlist('popup-form', 'popup-msg');
  handleWaitlist('teams-form', 'teams-msg');

  // ── 5-second popup ──
  setTimeout(function() {
    if (window.__waitlistDone) return;
    document.getElementById('email-popup').classList.add('visible');
  }, 5000);

  document.getElementById('popup-close').addEventListener('click', function() {
    document.getElementById('email-popup').classList.remove('visible');
  });
  document.getElementById('email-popup').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('visible');
  });
</script>
</body>
</html>`;
}

function renderHowItWorks(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD}
<title>How It Works | Invariant</title>
<style>
${SHARED_STYLES}
  .page-hero{padding:5rem 0 3rem;position:relative;}
  .page-hero::before{content:'';position:absolute;inset:0;background-image:radial-gradient(circle at 85% 10%, rgba(255,183,39,0.07), transparent 45%);pointer-events:none;}
  .page-hero .kicker{display:inline-flex;align-items:center;gap:0.75rem;font-family:var(--mono);font-size:0.72rem;letter-spacing:0.2em;text-transform:uppercase;color:var(--amber);margin-bottom:1.75rem;border:2px solid var(--amber);padding:0.55rem 1rem;animation:rise 0.8s ease both;}
  .page-hero .kicker::before{content:'';display:inline-block;width:9px;height:9px;background:var(--amber);animation:pulse 1.4s ease-in-out infinite;}
  .page-hero h1{font-family:var(--serif);font-size:clamp(3rem, 7vw, 6.5rem);font-weight:400;line-height:0.9;letter-spacing:-0.035em;color:var(--fg);margin-bottom:1.5rem;animation:rise 0.95s 0.1s ease both;}
  .page-hero h1 em{font-style:italic;color:var(--amber);}
  .page-hero .lede{font-family:var(--sans);font-size:clamp(1.05rem, 1.4vw, 1.3rem);color:#b4ae9f;max-width:640px;margin-top:1.5rem;line-height:1.45;animation:rise 0.95s 0.25s ease both;}

  .steps{padding:2rem 0 4rem;display:grid;gap:2.5rem;}
  .step{display:grid;grid-template-columns:auto 1fr;gap:2rem;border:2px solid var(--fg);background:#0a0a0a;padding:2rem 2.25rem;position:relative;transition:transform .2s ease, box-shadow .2s ease;animation:rise 0.9s ease both;}
  .step:nth-child(1){animation-delay:0.1s;}
  .step:nth-child(2){animation-delay:0.2s;}
  .step:nth-child(3){animation-delay:0.3s;}
  .step:nth-child(4){animation-delay:0.4s;}
  .step:nth-child(5){animation-delay:0.5s;}
  .step:hover{transform:translate(-3px,-3px);box-shadow:6px 6px 0 var(--amber);}
  .step:nth-child(even):hover{box-shadow:6px 6px 0 var(--cyan);}
  .step-num{font-family:var(--serif);font-style:italic;font-size:3.5rem;line-height:0.8;color:var(--amber);min-width:3.5rem;}
  .step-body h3{font-family:var(--serif);font-size:2rem;font-weight:400;color:var(--fg);margin-bottom:0.75rem;letter-spacing:-0.02em;}
  .step-body h3 em{font-style:italic;color:var(--amber);}
  .step-body p{font-family:var(--sans);font-size:0.95rem;color:#b4ae9f;margin-bottom:1rem;line-height:1.55;max-width:680px;}
  .step-body p a{color:var(--cyan);border-bottom:1px solid var(--cyan);}
  .step-body p strong{color:var(--fg);}
  .step-body pre{border:2px solid var(--line-strong);background:#050505;padding:1.1rem 1.35rem;font-family:var(--mono);font-size:0.78rem;color:var(--cream);overflow-x:auto;margin:0.5rem 0 1rem;box-shadow:-4px 4px 0 var(--line-strong);white-space:pre;}
  .step-body code{font-family:var(--mono);font-size:0.78rem;color:var(--amber);background:#050505;padding:0.15rem 0.45rem;border:1px solid var(--line-strong);}

  .cta-strip{border:2px solid var(--fg);background:#0a0a0a;padding:3rem 2.5rem;margin:3rem 0 4rem;display:flex;align-items:center;justify-content:space-between;gap:2rem;flex-wrap:wrap;box-shadow:-8px 8px 0 var(--cyan);}
  .cta-strip .cta-copy{flex:1;min-width:260px;}
  .cta-strip h2{font-family:var(--serif);font-size:clamp(1.8rem,3vw,2.8rem);color:var(--fg);line-height:0.95;margin-bottom:0.5rem;letter-spacing:-0.02em;}
  .cta-strip h2 em{font-style:italic;color:var(--amber);}
  .cta-strip p{font-family:var(--mono);font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.12em;}

  @media(max-width:720px){
    .step{grid-template-columns:1fr;gap:1rem;padding:1.5rem 1.35rem;}
    .step-num{font-size:2.5rem;}
    .step-body h3{font-size:1.5rem;}
    .cta-strip{padding:2rem 1.35rem;}
  }
</style>
</head>
<body>
${renderNav("how")}
<div class="container">
  <div class="page-hero">
    <div class="kicker">// the how</div>
    <h1>from zero to <em>shipping</em><br>in under a minute.</h1>
    <p class="lede">five steps. one key. every provider your agent will ever need, already plugged in.</p>
  </div>

  <div class="steps">
    <div class="step">
      <div class="step-num">01</div>
      <div class="step-body">
        <h3>create <em>your key.</em></h3>
        <p>drop your email on the <a href="/login">sign up page</a>. you get a unique api key instantly. no credit card. no approval. the free tier is 500 requests per month, forever.</p>
      </div>
    </div>

    <div class="step">
      <div class="step-num">02</div>
      <div class="step-body">
        <h3>wire it to <em>your agent.</em></h3>
        <p>works with any mcp-compatible client. one command for <strong>claude code</strong>:</p>
        <pre>claude mcp add invariant \\
  --transport http https://pclabs.dev/api/mcp \\
  --header "x-pl-key: pl_your_key"</pre>
        <p>for <strong>codex</strong>, edit <code>~/.codex/config.toml</code>:</p>
        <pre>[mcp_servers.invariant]
type = "http"
url = "https://pclabs.dev/api/mcp"

[mcp_servers.invariant.headers]
x-pl-key = "pl_your_key"</pre>
        <p>for <strong>cursor</strong>, add to <code>~/.cursor/mcp.json</code>:</p>
        <pre>{
  "mcpServers": {
    "invariant": {
      "url": "https://pclabs.dev/api/mcp",
      "headers": { "x-pl-key": "pl_your_key" }
    }
  }
}</pre>
        <p>same flow in windsurf, claude desktop, and claude.ai.</p>
      </div>
    </div>

    <div class="step">
      <div class="step-num">03</div>
      <div class="step-body">
        <h3>let it <em>pick the api.</em></h3>
        <p>not sure which provider fits? just ask your agent. <code>recommend</code>, <code>compare</code>, <code>list_providers</code>, and <code>get_api_docs</code> are exposed as mcp tools — the agent picks the best provider for the job, with a score and reasoning.</p>
        <pre>you: "find me a free api for real-time stock data"

agent calls recommend{
  need: "real-time stock data",
  priorities: ["cost","reliability"],
  budget: "free"
}

→ Finnhub (score 85/100)
  Free tier · 60 req/min · high reliability</pre>
      </div>
    </div>

    <div class="step">
      <div class="step-num">04</div>
      <div class="step-body">
        <h3>talk to it <em>in english.</em></h3>
        <p>ask your agent naturally. it routes to the right provider automatically.</p>
        <pre>"what's the weather in tokyo?"          → OpenWeatherMap
"look up adverse events for ibuprofen"  → OpenFDA
"get the BTC price"                     → CoinGecko
"what's AAPL trading at?"               → Finnhub
"find a crisis hotline for veterans"    → Mental Health</pre>
      </div>
    </div>

    <div class="step">
      <div class="step-num">05</div>
      <div class="step-body">
        <h3>watch the <em>usage tick.</em></h3>
        <p>head to the <a href="/dashboard">dashboard</a> for live quota, per-provider breakdown, and rate limits. your key sticks around in a cookie, no re-login.</p>
      </div>
    </div>
  </div>

  <div class="cta-strip">
    <div class="cta-copy">
      <h2>ready to <em>ship?</em></h2>
      <p>500 requests/month · zero credit card</p>
    </div>
    <a href="/login" class="btn btn-primary">claim your key →</a>
  </div>

  <footer class="page-footer">
    <span>© invariant</span>
    <a href="https://github.com/tobasummandal/invariant">github →</a>
  </footer>
</div>
<script>
  if (document.cookie.match(/pl_key=/)) {
    var links = document.querySelectorAll('nav .links a');
    links.forEach(function(a) { if (a.textContent === 'LOGIN') { a.href = '/dashboard'; a.textContent = 'DASHBOARD'; } });
  }
</script>
</body>
</html>`;
}

function renderLogin(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD}
<title>Sign In | Invariant</title>
<style>
${SHARED_STYLES}
  .login-page{padding:5rem 0 3rem;max-width:520px;margin:0 auto;position:relative;}
  .login-page::before{content:'';position:absolute;inset:-2rem -4rem;background-image:radial-gradient(circle at 20% 10%, rgba(255,183,39,0.06), transparent 45%),radial-gradient(circle at 100% 80%, rgba(95,211,255,0.05), transparent 45%);pointer-events:none;z-index:-1;}

  .login-kicker{display:inline-flex;align-items:center;gap:0.75rem;font-family:var(--mono);font-size:0.72rem;letter-spacing:0.2em;text-transform:uppercase;color:var(--amber);margin-bottom:1.5rem;border:2px solid var(--amber);padding:0.55rem 1rem;animation:rise 0.8s ease both;}
  .login-kicker::before{content:'';display:inline-block;width:9px;height:9px;background:var(--amber);animation:pulse 1.4s ease-in-out infinite;}

  .login-page h1{font-family:var(--serif);font-size:clamp(3rem, 6vw, 5rem);font-weight:400;line-height:0.9;letter-spacing:-0.035em;color:var(--fg);margin-bottom:1rem;animation:rise 0.95s 0.1s ease both;}
  .login-page h1 em{font-style:italic;color:var(--amber);}
  .login-page .sub{font-family:var(--sans);color:#b4ae9f;font-size:1.05rem;margin-bottom:3rem;animation:rise 0.95s 0.2s ease both;line-height:1.5;}

  .login-panel{border:2px solid var(--fg);background:#0a0a0a;padding:1.75rem 1.85rem;margin-bottom:1.5rem;position:relative;transition:transform .2s ease, box-shadow .2s ease;animation:rise 0.9s 0.3s ease both;}
  .login-panel:hover{transform:translate(-3px,-3px);box-shadow:6px 6px 0 var(--amber);}
  .login-panel:nth-of-type(2):hover{box-shadow:6px 6px 0 var(--cyan);}
  .login-panel::before{content:attr(data-tag);position:absolute;top:-10px;left:1rem;background:var(--bg);padding:0 0.6rem;font-family:var(--mono);font-size:0.6rem;color:var(--amber);letter-spacing:0.18em;font-weight:600;text-transform:uppercase;}
  .login-panel h2{font-family:var(--serif);font-size:1.8rem;font-weight:400;color:var(--fg);margin-bottom:0.35rem;letter-spacing:-0.02em;}
  .login-panel h2 em{font-style:italic;color:var(--amber);}
  .login-panel p{font-family:var(--mono);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.12em;color:var(--muted);margin-bottom:1.25rem;}
  .login-panel input{width:100%;background:#050505;border:2px solid var(--line-strong);padding:0.95rem 1.1rem;color:var(--fg);font-size:0.9rem;font-family:var(--mono);outline:none;transition:border-color .15s, box-shadow .15s;margin-bottom:1rem;}
  .login-panel input:focus{border-color:var(--amber);box-shadow:-4px 4px 0 var(--amber);}
  .login-panel input::placeholder{color:#55524a;}
  .login-panel button.btn{width:100%;padding:1rem;}

  .login-error{color:var(--red);font-family:var(--mono);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;margin-top:0.5rem;min-height:1em;}

  .or-divider{display:flex;align-items:center;gap:1rem;margin:2rem 0;font-family:var(--mono);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.22em;color:var(--muted);}
  .or-divider::before,.or-divider::after{content:'';flex:1;height:2px;background:var(--line-strong);}

  .toggle-mode{margin-top:1rem;font-family:var(--mono);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);text-align:center;}
  .toggle-mode a{color:var(--cyan);margin-left:0.375rem;border-bottom:1px solid var(--cyan);}
  .toggle-mode a:hover{color:var(--amber);border-bottom-color:var(--amber);}

  .flash{border:2px solid var(--amber);background:#0a0a0a;padding:1.25rem 1.4rem;margin-bottom:1.75rem;display:none;box-shadow:-6px 6px 0 var(--cyan);}
  .flash.visible{display:block;animation:rise 0.5s ease both;}
  .flash-label{font-family:var(--mono);font-size:0.65rem;color:var(--amber);text-transform:uppercase;letter-spacing:0.18em;margin-bottom:0.5rem;}
  .flash-key{font-family:var(--mono);font-size:0.95rem;color:var(--fg);cursor:pointer;word-break:break-all;font-weight:600;}
  .flash-key:hover{color:var(--amber);}
  .flash-sub{font-family:var(--mono);font-size:0.68rem;color:var(--muted);margin-top:0.6rem;letter-spacing:0.08em;}
  .flash-sub code{background:#050505;border:1px solid var(--line-strong);padding:0.1rem 0.4rem;color:var(--cyan);font-family:var(--mono);}

  .copied-toast{position:fixed;bottom:1.5rem;right:1.5rem;background:var(--amber);color:#000;padding:0.75rem 1.25rem;font-family:var(--mono);font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;opacity:0;transition:opacity .2s;pointer-events:none;border:2px solid var(--fg);box-shadow:-4px 4px 0 var(--fg);}
  .copied-toast.show{opacity:1;}

  @media(max-width:640px){
    .login-page{padding:3rem 0 2rem;}
  }
</style>
</head>
<body>
${renderNav("login")}
<div class="container">
  <div class="login-page">
    <div class="login-kicker"><span>// the door</span></div>
    <h1>welcome <em>back.</em></h1>
    <p class="sub">sign in with your existing key, or mint a fresh one. takes seconds.</p>

    <div id="key-flash" class="flash">
      <div class="flash-label">◆ your api key · click to copy</div>
      <div id="flash-key" class="flash-key"></div>
      <div class="flash-sub">save this key. add it to your mcp client as the <code>x-pl-key</code> header.</div>
    </div>

    <div class="login-panel" data-tag="EMAIL">
      <h2 id="email-panel-title">sign <em>in.</em></h2>
      <p id="email-panel-sub">with your email</p>
      <input type="email" id="email-input" placeholder="you@working.hard">
      <button class="btn btn-primary" id="email-submit-btn">sign in →</button>
      <div id="email-error" class="login-error"></div>
      <div class="toggle-mode">
        <span id="toggle-mode-text">don't have an account?</span>
        <a href="#" id="toggle-mode-link">create one</a>
      </div>
    </div>

    <div class="or-divider">or</div>

    <div class="login-panel" data-tag="KEY">
      <h2>sign in with <em>key.</em></h2>
      <p>for teams sharing one key</p>
      <input type="text" id="signin-key" placeholder="pl_your_key" autocomplete="off" spellcheck="false">
      <button class="btn btn-ghost" id="signin-btn">unlock →</button>
      <div id="signin-error" class="login-error"></div>
    </div>

    <footer class="page-footer">
      <span>© invariant</span>
      <a href="https://github.com/tobasummandal/invariant">github →</a>
    </footer>
  </div>
</div>
<div class="copied-toast" id="copied-toast">Copied</div>
<script>
(function() {
  // If already signed in, go to dashboard
  if (document.cookie.match(/pl_key=/)) {
    window.location.href = '/dashboard';
    return;
  }

  function setCookie(name, val) {
    document.cookie = name + '=' + encodeURIComponent(val) + '; path=/; max-age=' + (365*86400) + '; samesite=lax';
  }

  // Unified email panel — toggles between sign-in and create
  var mode = 'signin';
  var titleEl = document.getElementById('email-panel-title');
  var subEl = document.getElementById('email-panel-sub');
  var btnEl = document.getElementById('email-submit-btn');
  var toggleText = document.getElementById('toggle-mode-text');
  var toggleLink = document.getElementById('toggle-mode-link');
  var emailInput = document.getElementById('email-input');
  var errEl = document.getElementById('email-error');

  function setMode() {
    mode = 'signup';
    errEl.textContent = '';
    while (titleEl.firstChild) titleEl.removeChild(titleEl.firstChild);
    titleEl.appendChild(document.createTextNode('create '));
    var em = document.createElement('em');
    em.textContent = 'account.';
    titleEl.appendChild(em);
    subEl.textContent = 'free · 500 requests/month';
    btnEl.textContent = 'create account →';
    toggleText.textContent = 'already have an account?';
    toggleLink.textContent = 'use your api key below';
  }

  btnEl.addEventListener('click', doEmailSubmit);
  emailInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doEmailSubmit(); });

  async function doEmailSubmit() {
    var email = emailInput.value.trim();
    errEl.textContent = '';
    if (!email || !email.includes('@')) { errEl.textContent = 'Enter a valid email'; return; }
    var originalText = btnEl.textContent;
    btnEl.disabled = true; btnEl.textContent = '...';
    try {
      {
        var res = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email }),
        });
        var data = await res.json();
        if (!res.ok) { errEl.textContent = data.error || 'Signup failed'; return; }
        // Show key
        var flash = document.getElementById('key-flash');
        var flashKey = document.getElementById('flash-key');
        flashKey.textContent = data.key;
        flashKey.onclick = function() {
          navigator.clipboard.writeText(data.key);
          var t = document.getElementById('copied-toast');
          t.classList.add('show');
          setTimeout(function() { t.classList.remove('show'); }, 1200);
        };
        flash.classList.add('visible');
        setTimeout(function() { window.location.href = '/dashboard'; }, 3000);
      }
    } catch (e) { errEl.textContent = 'Connection error'; }
    finally { btnEl.disabled = false; btnEl.textContent = originalText; }
  }

  // Sign in
  document.getElementById('signin-btn').addEventListener('click', doSignin);
  document.getElementById('signin-key').addEventListener('keydown', function(e) { if (e.key === 'Enter') doSignin(); });

  async function doSignin() {
    var key = document.getElementById('signin-key').value.trim();
    var errEl = document.getElementById('signin-error');
    errEl.textContent = '';
    if (!key) { errEl.textContent = 'Enter your API key'; return; }
    try {
      var res = await fetch('/api/usage', { headers: { 'x-pl-key': key } });
      if (!res.ok) { errEl.textContent = 'Invalid key'; return; }
      setCookie('pl_key', key);
      window.location.href = '/dashboard';
    } catch (e) { errEl.textContent = 'Connection error'; }
  }
})();
</script>
</body>
</html>`;
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
                .map(
                  (pr) =>
                    `<span class="param${pr.required ? " required" : ""}">${pr.name}</span>`,
                )
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
${SHARED_HEAD}
<title>Dashboard | Invariant</title>
<style>
${SHARED_STYLES}
  /* ── dashboard hero ── */
  .dash-hero{padding:4rem 0 2rem;position:relative;}
  .dash-hero::before{content:'';position:absolute;inset:0;background-image:radial-gradient(circle at 90% 0%, rgba(255,183,39,0.06), transparent 45%);pointer-events:none;}
  .dash-hero .kicker{display:inline-flex;align-items:center;gap:0.75rem;font-family:var(--mono);font-size:0.72rem;letter-spacing:0.2em;text-transform:uppercase;color:var(--amber);margin-bottom:1.5rem;border:2px solid var(--amber);padding:0.55rem 1rem;animation:rise 0.8s ease both;}
  .dash-hero .kicker::before{content:'';display:inline-block;width:9px;height:9px;background:var(--amber);animation:pulse 1.4s ease-in-out infinite;}
  .dash-hero h1{font-family:var(--serif);font-size:clamp(3rem, 7vw, 6rem);font-weight:400;line-height:0.9;letter-spacing:-0.035em;color:var(--fg);margin-bottom:1rem;animation:rise 0.95s 0.1s ease both;}
  .dash-hero h1 em{font-style:italic;color:var(--amber);}
  .dash-hero .lede{font-family:var(--mono);font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.15em;animation:rise 0.95s 0.2s ease both;}
  .dash-hero .lede span{color:var(--fg);}

  /* ── tabs ── */
  .tabs{display:flex;gap:0;margin:2.5rem 0 2rem;border-bottom:2px solid var(--fg);}
  .tab{padding:1rem 2rem;font-family:var(--mono);font-size:0.72rem;font-weight:600;color:var(--muted);cursor:pointer;border:2px solid transparent;border-bottom:none;text-transform:uppercase;letter-spacing:0.14em;transition:all .15s;margin-bottom:-2px;}
  .tab:hover{color:var(--fg);}
  .tab.active{color:#000;background:var(--fg);border-color:var(--fg);}
  .tab-content{display:none;}
  .tab-content.active{display:block;animation:rise 0.5s ease both;}

  /* ── stats grid ── */
  .stats{display:grid;grid-template-columns:repeat(4,1fr);border:2px solid var(--fg);background:#0a0a0a;margin-bottom:2.5rem;}
  .stat{padding:2rem 1.75rem 1.5rem;border-right:2px solid var(--fg);position:relative;transition:background .25s;}
  .stat:last-child{border-right:none;}
  .stat:hover{background:var(--fg);}
  .stat:hover .stat-value{color:#000;}
  .stat:hover .stat-label{color:#333;}
  .stat::before{content:attr(data-num);position:absolute;top:0.65rem;right:0.85rem;font-family:var(--mono);font-size:0.6rem;color:#3a362d;letter-spacing:0.15em;}
  .stat-value{font-family:var(--serif);font-size:clamp(2.4rem,4.5vw,3.6rem);font-weight:400;color:var(--fg);line-height:0.95;font-variant-numeric:tabular-nums;letter-spacing:-0.04em;transition:color .25s;}
  .stat-value.green{color:var(--amber);}
  .stat-value.amber{color:var(--cyan);}
  .stat-label{font-family:var(--mono);font-size:0.66rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.14em;margin-top:0.75rem;font-weight:500;transition:color .25s;}

  /* ── usage panel ── */
  .usage-panel{border:2px solid var(--fg);background:#0a0a0a;padding:2rem 2.25rem;margin-bottom:2.5rem;position:relative;box-shadow:-6px 6px 0 var(--cyan);}
  .usage-panel::before{content:'USAGE';position:absolute;top:-10px;left:1rem;background:var(--bg);padding:0 0.6rem;font-family:var(--mono);font-size:0.6rem;color:var(--amber);letter-spacing:0.18em;font-weight:600;}
  .usage-panel h2{font-family:var(--serif);font-size:1.6rem;font-weight:400;color:var(--fg);margin-bottom:1.25rem;letter-spacing:-0.02em;text-transform:none;}
  .usage-meta{display:flex;gap:2rem;margin-bottom:1rem;font-family:var(--mono);font-size:0.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;flex-wrap:wrap;}
  .usage-meta span{color:var(--fg);}
  .quota-bar-outer{width:100%;height:10px;background:#050505;border:2px solid var(--line-strong);overflow:hidden;margin-bottom:1rem;}
  .quota-bar-inner{height:100%;background:var(--amber);transition:width .3s;}
  .quota-bar-inner.warn{background:var(--cyan);}
  .quota-bar-inner.critical{background:var(--red);}
  .usage-numbers{display:flex;justify-content:space-between;font-family:var(--mono);font-size:0.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:1.25rem;}
  .usage-numbers span{font-variant-numeric:tabular-nums;color:var(--fg);}
  .usage-breakdown{display:flex;flex-wrap:wrap;gap:0.5rem;}
  .usage-chip{font-family:var(--mono);font-size:0.68rem;padding:0.4rem 0.8rem;background:#050505;border:1px solid var(--line-strong);color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;}
  .usage-chip .chip-count{color:var(--amber);margin-left:0.5rem;font-weight:600;}
  .usage-key-btn{font-family:var(--mono);font-size:0.68rem;color:var(--fg);cursor:pointer;background:#050505;border:2px solid var(--line-strong);padding:0.45rem 0.85rem;transition:all .15s;text-transform:uppercase;letter-spacing:0.1em;}
  .usage-key-btn:hover{border-color:var(--amber);color:var(--amber);}
  .usage-signout{background:transparent;border:2px solid var(--line-strong);padding:0.45rem 0.85rem;color:var(--muted);font-family:var(--mono);font-size:0.66rem;cursor:pointer;text-transform:uppercase;letter-spacing:0.12em;transition:all .15s;}
  .usage-signout:hover{border-color:var(--red);color:var(--red);}

  /* ── routing stats ── */
  .routing-stats{display:grid;grid-template-columns:repeat(3,1fr);border:2px solid var(--line-strong);background:#050505;margin-bottom:1rem;}
  .routing-stat{padding:1.25rem 1rem;text-align:center;border-right:2px solid var(--line-strong);}
  .routing-stat:last-child{border-right:none;}
  .routing-stat-value{font-family:var(--serif);font-size:2rem;color:var(--fg);line-height:1;font-variant-numeric:tabular-nums;}
  .routing-stat-label{font-family:var(--mono);font-size:0.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.14em;margin-top:0.5rem;}
  .routing-provider{display:flex;justify-content:space-between;align-items:center;padding:0.65rem 0;border-bottom:1px solid var(--line);font-family:var(--mono);font-size:0.78rem;}
  .routing-provider:last-child{border-bottom:none;}
  .routing-provider .name{color:var(--fg);}
  .routing-provider .count{color:var(--amber);font-size:0.72rem;font-weight:600;}
  .routing-provider .bar{height:6px;background:#050505;border:1px solid var(--line-strong);flex:1;margin:0 1rem;position:relative;}
  .routing-provider .bar-fill{position:absolute;left:0;top:0;height:100%;background:var(--amber);transition:width .3s;}

  /* ── endpoints ── */
  .endpoints{border:2px solid var(--fg);background:#0a0a0a;padding:1.5rem 1.85rem;margin-bottom:3rem;position:relative;box-shadow:-6px 6px 0 var(--amber);}
  .endpoints::before{content:'ENDPOINTS';position:absolute;top:-10px;left:1rem;background:var(--bg);padding:0 0.6rem;font-family:var(--mono);font-size:0.6rem;color:var(--amber);letter-spacing:0.18em;font-weight:600;}
  .endpoints h2{display:none;}
  .endpoint{display:flex;align-items:center;gap:1rem;padding:0.6rem 0;color:var(--fg);font-family:var(--mono);font-size:0.8rem;border-bottom:1px solid var(--line);}
  .endpoint:last-child{border-bottom:none;}
  .method{font-weight:700;min-width:3.5rem;font-size:0.68rem;padding:0.2rem 0.5rem;text-align:center;border:2px solid currentColor;}
  .method.get{color:var(--cyan);}
  .method.post{color:var(--amber);}
  .endpoint-path{color:var(--fg);}
  .endpoint-desc{color:var(--muted);margin-left:auto;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;}

  /* ── categories ── */
  .category{margin-bottom:3rem;}
  .category-header{display:flex;align-items:baseline;gap:1rem;margin-bottom:1.25rem;padding-bottom:1rem;border-bottom:2px solid var(--fg);}
  .category-icon{width:2rem;height:2rem;display:flex;align-items:center;justify-content:center;background:var(--amber);color:#000;font-family:var(--mono);font-size:0.8rem;font-weight:700;border:2px solid var(--fg);}
  .category-header h2{font-family:var(--serif);font-style:italic;font-size:1.75rem;font-weight:400;color:var(--fg);letter-spacing:-0.015em;text-transform:lowercase;flex:1;}
  .category-count{font-family:var(--mono);font-size:0.68rem;color:var(--amber);border:2px solid var(--amber);padding:0.25rem 0.6rem;text-transform:uppercase;letter-spacing:0.1em;}

  /* ── provider cards ── */
  .provider{border:2px solid var(--line-strong);background:#050505;padding:1.5rem 1.75rem;margin-bottom:1rem;transition:all .2s ease;}
  .provider:hover{border-color:var(--fg);transform:translate(-2px,-2px);box-shadow:4px 4px 0 var(--amber);}
  .provider-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.75rem;gap:1rem;}
  .provider-title{display:flex;align-items:baseline;gap:0.75rem;flex-wrap:wrap;}
  .provider-title h3{font-family:var(--serif);font-size:1.4rem;font-weight:400;color:var(--fg);letter-spacing:-0.015em;}
  .provider-id{font-family:var(--mono);font-size:0.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;}
  .provider-desc{font-family:var(--sans);font-size:0.88rem;color:#b4ae9f;margin-bottom:1rem;line-height:1.5;}

  /* ── badges ── */
  .badge{font-family:var(--mono);font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;padding:0.3rem 0.65rem;border:2px solid currentColor;}
  .badge.live{color:var(--amber);}
  .badge.live::before{content:'● ';animation:pulse 1.6s ease-in-out infinite;}
  .badge.no-key{color:var(--muted);}

  /* ── actions ── */
  .actions-list{display:flex;flex-direction:column;gap:0.5rem;margin-top:0.75rem;}
  .action{background:#030303;border:1px solid var(--line);padding:0.85rem 1.1rem;}
  .action code{font-family:var(--mono);font-size:0.8rem;color:var(--cyan);font-weight:600;}
  .action-desc{font-family:var(--sans);font-size:0.78rem;color:var(--muted);margin-left:0.75rem;}
  .params{margin-top:0.5rem;display:flex;flex-wrap:wrap;gap:0.375rem;}
  .param{font-family:var(--mono);font-size:0.62rem;padding:0.2rem 0.55rem;background:#050505;border:1px solid var(--line);color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;}
  .param.required{color:var(--amber);border-color:var(--amber);}

  /* ── admin ── */
  .admin-login{border:2px solid var(--fg);background:#0a0a0a;padding:1.75rem 1.85rem;max-width:420px;position:relative;box-shadow:-6px 6px 0 var(--cyan);}
  .admin-login::before{content:'ADMIN';position:absolute;top:-10px;left:1rem;background:var(--bg);padding:0 0.6rem;font-family:var(--mono);font-size:0.6rem;color:var(--amber);letter-spacing:0.18em;font-weight:600;}
  .admin-login h2{font-family:var(--serif);font-size:1.6rem;font-weight:400;color:var(--fg);margin-bottom:1.25rem;}
  .admin-login input{width:100%;background:#050505;border:2px solid var(--line-strong);padding:0.85rem 1rem;color:var(--fg);font-size:0.85rem;font-family:var(--mono);outline:none;margin-bottom:0.85rem;transition:border-color .15s;}
  .admin-login input:focus{border-color:var(--amber);}
  .admin-login button{padding:0.85rem 1.5rem;font-family:var(--mono);font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;border:2px solid var(--fg);background:var(--fg);color:#000;cursor:pointer;transition:all .2s;}
  .admin-login button:hover{background:var(--amber);border-color:var(--amber);}
  .admin-error{color:var(--red);font-family:var(--mono);font-size:0.7rem;margin-top:0.5rem;text-transform:uppercase;letter-spacing:0.1em;}

  .accounts-table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:0.78rem;border:2px solid var(--fg);background:#0a0a0a;}
  .accounts-table th{text-align:left;font-size:0.65rem;text-transform:uppercase;letter-spacing:0.14em;color:var(--amber);font-weight:600;padding:0.85rem 1rem;border-bottom:2px solid var(--fg);background:#050505;}
  .accounts-table td{padding:0.85rem 1rem;border-bottom:1px solid var(--line);color:var(--fg);vertical-align:middle;}
  .accounts-table tr:last-child td{border-bottom:none;}
  .accounts-table tr:hover td{background:#050505;}
  .key-cell{cursor:pointer;color:var(--cyan);transition:color .15s;}
  .key-cell:hover{color:var(--amber);}
  .key-cell .copy-hint{font-size:0.58rem;color:var(--muted);margin-left:0.5rem;text-transform:uppercase;letter-spacing:0.1em;}
  .mini-bar{width:80px;height:6px;background:#050505;border:1px solid var(--line-strong);overflow:hidden;display:inline-block;vertical-align:middle;margin-right:0.5rem;}
  .mini-bar-inner{height:100%;background:var(--amber);}
  .mini-bar-inner.warn{background:var(--cyan);}
  .mini-bar-inner.critical{background:var(--red);}
  .tier-badge{font-size:0.58rem;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;padding:0.2rem 0.55rem;border:2px solid var(--line-strong);color:var(--muted);}

  /* ── create key form ── */
  .create-key{border:2px solid var(--fg);background:#0a0a0a;padding:1.5rem 1.85rem;margin-bottom:2rem;position:relative;box-shadow:-6px 6px 0 var(--amber);}
  .create-key::before{content:'NEW KEY';position:absolute;top:-10px;left:1rem;background:var(--bg);padding:0 0.6rem;font-family:var(--mono);font-size:0.6rem;color:var(--amber);letter-spacing:0.18em;font-weight:600;}
  .create-key h2{font-family:var(--serif);font-size:1.4rem;font-weight:400;color:var(--fg);margin-bottom:1.25rem;}
  .create-key-form{display:flex;gap:0.85rem;align-items:flex-end;flex-wrap:wrap;}
  .form-field{display:flex;flex-direction:column;gap:0.35rem;}
  .form-field label{font-family:var(--mono);font-size:0.6rem;text-transform:uppercase;letter-spacing:0.14em;color:var(--amber);}
  .form-field input,.form-field select{background:#050505;border:2px solid var(--line-strong);padding:0.6rem 0.85rem;color:var(--fg);font-size:0.8rem;font-family:var(--mono);outline:none;transition:border-color .15s;}
  .form-field input:focus,.form-field select:focus{border-color:var(--amber);}
  .form-field select{cursor:pointer;}
  .create-btn{border:2px solid var(--fg);background:var(--fg);color:#000;padding:0.7rem 1.5rem;font-family:var(--mono);font-size:0.75rem;font-weight:700;cursor:pointer;transition:all .2s;text-transform:uppercase;letter-spacing:0.12em;height:fit-content;}
  .create-btn:hover{background:var(--amber);border-color:var(--amber);}

  /* ── flash ── */
  .flash{border:2px solid var(--amber);background:#0a0a0a;padding:1.25rem 1.4rem;margin-bottom:1.75rem;display:none;box-shadow:-6px 6px 0 var(--cyan);}
  .flash.visible{display:block;animation:rise 0.5s ease both;}
  .flash-label{font-family:var(--mono);font-size:0.62rem;color:var(--amber);text-transform:uppercase;letter-spacing:0.18em;margin-bottom:0.5rem;}
  .flash-key{font-family:var(--mono);font-size:0.95rem;color:var(--fg);cursor:pointer;word-break:break-all;font-weight:600;}
  .flash-key:hover{color:var(--amber);}
  .flash-sub{font-family:var(--mono);font-size:0.65rem;color:var(--muted);margin-top:0.5rem;letter-spacing:0.08em;}

  .copied-toast{position:fixed;bottom:1.5rem;right:1.5rem;background:var(--amber);color:#000;padding:0.75rem 1.25rem;font-family:var(--mono);font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;opacity:0;transition:opacity .2s;pointer-events:none;border:2px solid var(--fg);box-shadow:-4px 4px 0 var(--fg);}
  .copied-toast.show{opacity:1;}

  @media(max-width:900px){
    .stats{grid-template-columns:repeat(2,1fr);}
    .stat:nth-child(2){border-right:none;}
    .stat:nth-child(1),.stat:nth-child(2){border-bottom:2px solid var(--fg);}
    .routing-stats{grid-template-columns:1fr;}
    .routing-stat{border-right:none;border-bottom:2px solid var(--line-strong);}
    .routing-stat:last-child{border-bottom:none;}
  }
  @media(max-width:640px){
    .endpoint-desc{display:none;}
    .provider-title{flex-direction:column;gap:0.125rem;}
    .create-key-form{flex-direction:column;align-items:stretch;}
    .accounts-table{font-size:0.68rem;}
    .tabs{overflow-x:auto;}
  }
</style>
</head>
<body>
<script>if(!document.cookie.match(/pl_key=/))window.location.href='/login';</script>
${renderNav("dashboard")}
<script>
  (function(){
    var links = document.querySelectorAll('nav .links a');
    links.forEach(function(a) {
      if (a.textContent === 'LOGIN') {
        a.href = '/dashboard';
        a.textContent = 'DASHBOARD';
        a.classList.add('active');
      }
    });
  })();
</script>
<div class="container">
  <div class="dash-hero">
    <div class="kicker">// the console</div>
    <h1>your <em>gateway.</em></h1>
    <p class="lede"><span>${total}</span> providers · <span>${Object.keys(grouped).length}</span> categories · wired and live</p>
  </div>

  <div class="tabs">
    <div class="tab active" data-tab="home">Usage</div>
    <div class="tab" data-tab="admin">Admin</div>
  </div>

  <!-- Home Tab -->
  <div id="tab-home" class="tab-content active">
    <div class="stats">
      <div class="stat" data-num="01 ▸">
        <div class="stat-value">${total}</div>
        <div class="stat-label">Total Providers</div>
      </div>
      <div class="stat" data-num="02 ▸">
        <div class="stat-value green">${live}</div>
        <div class="stat-label">Live</div>
      </div>
      <div class="stat" data-num="03 ▸">
        <div class="stat-value amber">${total - live}</div>
        <div class="stat-label">Needs API Key</div>
      </div>
      <div class="stat" data-num="04 ▸">
        <div class="stat-value">${noKey}</div>
        <div class="stat-label">Free (No Key)</div>
      </div>
    </div>

    <!-- Usage: logged-in state -->
    <div id="usage-logged-in" class="usage-panel" style="display:none">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;gap:1rem;flex-wrap:wrap">
        <h2 id="usage-title" style="margin:0"></h2>
        <div style="display:flex;align-items:center;gap:0.75rem">
          <button id="usage-key-display" class="usage-key-btn" title="Click to copy full key"></button>
          <button id="usage-signout" class="usage-signout">sign out</button>
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

    <!-- Smart Routing Stats -->
    <div id="routing-panel" class="usage-panel" style="display:none">
      <h2>Smart Routing</h2>
      <div class="routing-stats">
        <div class="routing-stat">
          <div class="routing-stat-value" id="routing-total">0</div>
          <div class="routing-stat-label">Total Routed</div>
        </div>
        <div class="routing-stat">
          <div class="routing-stat-value" id="routing-fallbacks">0</div>
          <div class="routing-stat-label">Auto-Fallbacks</div>
        </div>
        <div class="routing-stat">
          <div class="routing-stat-value" id="routing-smart">0</div>
          <div class="routing-stat-label">Smart Routes</div>
        </div>
      </div>
      <div id="routing-providers" style="margin-top:1rem"></div>
    </div>

    <div class="endpoints">
      <h2>Endpoints</h2>
      <div class="endpoint"><span class="method get">GET</span><span class="endpoint-path">/api/providers</span><span class="endpoint-desc">list available providers</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="endpoint-path">/api/query</span><span class="endpoint-desc">execute a provider action</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="endpoint-path">/api/mcp</span><span class="endpoint-desc">MCP protocol (JSON-RPC)</span></div>
      <div class="endpoint"><span class="method get">GET</span><span class="endpoint-path">/api/usage</span><span class="endpoint-desc">check quota and usage breakdown</span></div>
      <div class="endpoint"><span class="method post">POST</span><span class="endpoint-path">/api/recommend</span><span class="endpoint-desc">AI-powered provider recommendations</span></div>
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
        <div class="flash-label">new key created. click to copy</div>
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

  <footer class="page-footer">
    <span>© invariant</span>
    <a href="https://github.com/tobasummandal/invariant">github →</a>
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
    document.getElementById('usage-title').textContent = 'your usage | ' + u.tier + ' tier';
    document.getElementById('usage-key-display').textContent = maskKey(key) + '  copy';
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
  }

  async function fetchUsage(key) {
    const res = await fetch('/api/usage', { headers: { 'x-pl-key': key } });
    if (!res.ok) return null;
    return await res.json();
  }

  // Fetch and render routing stats
  async function loadRoutingStats(key) {
    try {
      var res = await fetch('/api/routing-stats', { headers: { 'x-pl-key': key } });
      if (!res.ok) return;
      var stats = await res.json();
      if (stats.total === 0) return;
      document.getElementById('routing-total').textContent = stats.total;
      document.getElementById('routing-fallbacks').textContent = stats.fallbacks;
      document.getElementById('routing-smart').textContent = stats.smartRoutes;
      var maxCount = stats.byProvider.length ? stats.byProvider[0].count : 1;
      document.getElementById('routing-providers').innerHTML = stats.byProvider.map(function(p) {
        var pct = Math.round((p.count / maxCount) * 100);
        return '<div class="routing-provider"><span class="name">' + p.provider + '</span><div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div><span class="count">' + p.count + '</span></div>';
      }).join('');
      document.getElementById('routing-panel').style.display = 'block';
    } catch(e) {}
  }

  // Auto-load from cookie
  const savedKey = getCookie('pl_key');
  if (savedKey) {
    fetchUsage(savedKey).then(u => {
      if (u) showUsagePanel(u, savedKey);
      else { deleteCookie('pl_key'); window.location.href = '/login'; }
    }).catch(() => {});
    loadRoutingStats(savedKey);
  }

  // Copy full key from logged-in display
  document.getElementById('usage-key-display').addEventListener('click', function() {
    var el = this;
    var key = getCookie('pl_key');
    if (!key) return;
    navigator.clipboard.writeText(key).then(function() {
      el.textContent = 'copied!';
      setTimeout(function() { el.textContent = maskKey(key) + '  copy'; }, 1500);
    });
  });

  // Sign out → redirect to login
  document.getElementById('usage-signout').addEventListener('click', () => {
    deleteCookie('pl_key');
    window.location.href = '/login';
  });

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
  function escapeHtml(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  function renderAccounts(accounts) {
    const tbody = document.getElementById('accounts-body');
    tbody.innerHTML = accounts.map(a => {
      var safeEmail = a.email ? escapeHtml(a.email) : '<span style="color:#404040">·</span>';
      const pct = Math.min(100, (a.used / a.quota) * 100);
      const cls = barClass(a.used, a.quota);
      const date = new Date(a.createdAt).toLocaleDateString();
      return '<tr>'
        + '<td class="key-cell" data-key="' + escapeHtml(a.key) + '" title="Click to copy">' + maskKey(a.key) + '<span class="copy-hint">copy</span></td>'
        + '<td>' + safeEmail + '</td>'
        + '<td><span class="tier-badge">' + escapeHtml(a.tier) + '</span></td>'
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
    return res.end(
      JSON.stringify({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      }),
    );
  }

  if (path === "/register" && req.method === "POST") {
    const regBody = await parseBody(req);
    res.writeHead(201, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        client_id: crypto.randomBytes(16).toString("hex"),
        redirect_uris: regBody.redirect_uris ?? [],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    );
  }

  if (path === "/authorize") {
    if (req.method === "GET") {
      const params = querystring.parse(qs || "");
      const get = (k: string) =>
        (Array.isArray(params[k]) ? params[k]![0] : (params[k] as string)) ??
        "";
      if (get("response_type") !== "code") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "unsupported_response_type" }));
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(
        renderAuthorizeForm({
          clientId: get("client_id"),
          redirectUri: get("redirect_uri"),
          state: get("state"),
          codeChallenge: get("code_challenge"),
          codeChallengeMethod: get("code_challenge_method") || "S256",
        }),
      );
    }
    if (req.method === "POST") {
      const body = await parseFormBody(req);
      const {
        client_id,
        redirect_uri,
        state,
        code_challenge,
        code_challenge_method,
        api_key,
      } = body;
      const account = await getAccount(api_key);
      if (!account) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(
          renderAuthorizeForm({
            clientId: client_id ?? "",
            redirectUri: redirect_uri ?? "",
            state: state ?? "",
            codeChallenge: code_challenge ?? "",
            codeChallengeMethod: code_challenge_method ?? "S256",
            error: "Invalid API key. Check your key and try again.",
          }),
        );
      }
      const code = crypto.randomBytes(20).toString("hex");
      pendingCodes.set(code, {
        apiKey: api_key,
        redirectUri: redirect_uri ?? "",
        codeChallenge: code_challenge ?? "",
        expiresAt: Date.now() + 5 * 60_000,
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
      return res.end(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Code expired or not found",
        }),
      );
    }
    if (
      pending.redirectUri !== redirect_uri ||
      !code_verifier ||
      !verifyPKCE(code_verifier, pending.codeChallenge)
    ) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "PKCE or redirect_uri mismatch",
        }),
      );
    }
    pendingCodes.delete(code!);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({ access_token: pending.apiKey, token_type: "bearer" }),
    );
  }

  // ── API routes ─────────────────────────────────────────────────────────────
  const body = await parseBody(req);

  // Lift Bearer token → x-pl-key so existing handlers validate it transparently
  const authHeader = req.headers["authorization"];
  if (
    authHeader?.toLowerCase().startsWith("bearer ") &&
    !req.headers["x-pl-key"]
  ) {
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

  // ── Pages ───────────────────────────────────────────────────────────────
  if (path === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(renderHomepage());
  }

  if (path === "/how-it-works") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(renderHowItWorks());
  }

  if (path === "/login") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(renderLogin());
  }

  if (path === "/dashboard") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(renderDashboard());
  }

  if (path === "/api/health") {
    res.setHeader("Content-Type", "application/json");
    return res.end(
      JSON.stringify({ status: "ok", providers: getHealthData() }),
    );
  }

  if (path === "/api/providers") return providersHandler(fakeReq, fakeRes);
  if (path === "/api/query") return queryHandler(fakeReq, fakeRes);
  if (path === "/api/recommend") return recommendHandler(fakeReq, fakeRes);
  if (path === "/api/mcp") {
    // Authenticate
    const plKey = req.headers["x-pl-key"] as string;
    if (!plKey) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Missing x-pl-key header" }));
    }
    const account = await getAccount(plKey);
    if (!account) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Invalid API key" }));
    }

    // Check for existing session
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && mcpSessions.has(sessionId)) {
      return mcpSessions
        .get(sessionId)!
        .transport.handleRequest(req, res, body);
    }

    // New session (must be initialize request or POST without session)
    if (req.method === "POST") {
      const session = await createMcpSession(account.id);
      await session.transport.handleRequest(req, res, body);
      // Store session after initialize sets the session ID
      if (session.transport.sessionId) {
        mcpSessions.set(session.transport.sessionId, session);
      }
      return;
    }

    // GET for SSE stream on existing session
    if (req.method === "GET" && sessionId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Session not found" }));
    }

    // DELETE to close session
    if (req.method === "DELETE" && sessionId && mcpSessions.has(sessionId)) {
      const session = mcpSessions.get(sessionId)!;
      await session.transport.close();
      mcpSessions.delete(sessionId);
      res.writeHead(200);
      return res.end();
    }

    res.writeHead(405, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }
  if (path === "/api/usage") return usageHandler(fakeReq, fakeRes);

  // ── Admin API ────────────────────────────────────────────────────────────
  const adminPass = process.env.ADMIN_PASSWORD;
  const checkAdmin = () => {
    if (!adminPass) return false;
    return req.headers["x-admin-pass"] === adminPass;
  };

  if (path === "/api/admin/accounts" && req.method === "GET") {
    if (!checkAdmin()) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Invalid admin password" }));
    }
    const accounts = await getAllAccounts();
    const withUsage = await Promise.all(
      accounts.map(async (a) => {
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
      }),
    );
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
      perMinuteRate: body.per_minute_rate
        ? Number(body.per_minute_rate)
        : undefined,
    });
    if (!account) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Failed to create account" }));
    }
    if (body.email) addToWaitlist(body.email).catch(() => {});
    res.writeHead(201, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        account: {
          key: account.pl_key,
          email: account.email,
          tier: account.tier,
          quota: account.monthly_quota,
          perMinuteRate: account.per_minute_rate,
        },
      }),
    );
  }

  // ── Public signup ─────────────────────────────────────────────────────────
  if (path === "/api/signup" && req.method === "POST") {
    const email = (body.email || "").trim().toLowerCase();
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
    addToWaitlist(email).catch(() => {});
    res.writeHead(201, {
      "Content-Type": "application/json",
      "Set-Cookie": `pl_key=${plKey}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`,
    });
    return res.end(
      JSON.stringify({
        key: plKey,
        tier: account.tier,
        quota: account.monthly_quota,
      }),
    );
  }

  if (path === "/api/routing-stats" && req.method === "GET") {
    const plKey = req.headers["x-pl-key"] as string;
    const isAdmin = req.headers["x-admin-pass"] === adminPass;
    if (!plKey && !isAdmin) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({ error: "Missing x-pl-key or x-admin-pass" }),
      );
    }
    let stats;
    if (isAdmin) {
      stats = await getRoutingStats();
    } else {
      const account = await getAccount(plKey);
      if (!account) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Invalid key" }));
      }
      stats = await getRoutingStats(account.id);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(stats));
  }

  // /api/signin-email disabled: exposed API keys without ownership verification.
  // Users sign in with their API key directly via the key-based sign-in flow.
  if (path === "/api/signin-email") {
    res.writeHead(410, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        error:
          "Email sign-in has been disabled. Please sign in with your API key.",
      }),
    );
  }

  if (path === "/api/waitlist" && req.method === "POST") {
    const email = (body.email || "").trim();
    if (!email || !email.includes("@")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Valid email is required" }));
    }
    const ok = await addToWaitlist(email);
    if (!ok) {
      res.writeHead(409, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Already on the list" }));
    }
    res.writeHead(201, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  res.statusCode = 404;
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`dev server running on http://localhost:${PORT}`);
});
