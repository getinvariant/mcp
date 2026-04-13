# Hackathon Quickstart — invariant

**Goal:** in under 5 minutes, your AI agent will be able to call 5+ live APIs (weather, crypto, stocks, FDA drug data, mental health resources) with zero signups, zero `.env` files, and zero API keys to manage.

This is the only credential you need: a **`pl_` key** from us.

---

## 0. What is this?

`invariant` is a single MCP gateway that fronts a bunch of APIs. Instead of signing up for OpenWeather + CoinGecko + Finnhub + … you sign up _once_ with us. Your agent talks to one URL with one header. We hold the upstream keys.

**One key in. Every API out.**

---

## 1. Get your key (30 seconds)

1. Go to **https://pclabs.dev**
2. Click **Login** (top right) and enter your email
3. You'll get a **`pl_...`** key on the dashboard. Copy it. That's the only credential you'll ever paste.

> Free tier = **500 requests / month** and **10 requests / minute**. If you start hitting 429s, slow down — the per-minute cap is the more common one to trip.

---

## 2. Plug it into your AI tool (1 minute)

Pick the one you use. Replace `pl_your_key` with the key from step 1.

### Claude Code (CLI)

```bash
claude mcp add invariant \
  --transport http https://pclabs.dev/api/mcp \
  --header "x-pl-key: pl_your_key"
```

Then quit and restart your `claude` session.

### Cursor

Open `~/.cursor/mcp.json` (create it if missing) and add:

```json
{
  "mcpServers": {
    "invariant": {
      "url": "https://pclabs.dev/api/mcp",
      "headers": { "x-pl-key": "pl_your_key" }
    }
  }
}
```

Then **Cursor → Settings → Tools & Integrations → MCP** and toggle `invariant` on.

### Windsurf

Open `~/.codeium/windsurf/mcp_config.json` and add the same `mcpServers` block as Cursor above. Reload the Cascade panel.

### Claude Desktop

Open `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "invariant": {
      "type": "http",
      "url": "https://pclabs.dev/api/mcp",
      "headers": { "x-pl-key": "pl_your_key" }
    }
  }
}
```

Restart Claude Desktop.

### claude.ai (web)

**Settings → Connectors → Add custom connector**, paste `https://pclabs.dev/api/mcp` and add `x-pl-key: pl_your_key` as a header. No file editing required.

### Codex CLI

```bash
codex mcp add invariant --url https://pclabs.dev/api/mcp
```

Then open `~/.codex/config.toml` and add the header (Codex doesn't accept headers via CLI yet):

```toml
[mcp_servers.invariant.headers]
x-pl-key = "pl_your_key"
```

---

## 3. Sanity check (10 seconds)

Ask your agent:

> _"List all the providers invariant has."_

It should call the `list_providers` tool and print 5+ providers with `Status: Ready`. If you see `Not configured`, that one's offline — pick a different one.

If your agent says "I don't see invariant" or "no MCP tools available," you forgot to restart the client after editing the config.

---

## 4. Try it

These all work _right now_ on the hosted gateway. Type them into your agent verbatim:

| Ask your agent…                                         | What happens                                |
| ------------------------------------------------------- | ------------------------------------------- |
| `what's the weather in tokyo?`                          | OpenWeatherMap → temp, humidity, conditions |
| `get the bitcoin price in USD`                          | CoinGecko → live BTC quote                  |
| `what's AAPL trading at right now?`                     | Finnhub → live stock quote                  |
| `look up adverse events for ibuprofen`                  | OpenFDA → real FDA reports                  |
| `find me a crisis hotline for veterans`                 | Mental Health Resources                     |
| `recommend a free API for crypto prices with no signup` | Returns ranked list with scores             |

The agent will figure out which provider to call. You don't pick — that's the whole point.

---

## 5. The 4 MCP tools your agent has

If you're curious what's actually wired up:

| Tool             | What it does                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `list_providers` | Browse the catalog (filter by `category`: `physical_health`, `financial`, `environment`, `ai`, `maps`, `mental_health`, `social_impact`) |
| `get_api_docs`   | Full integration docs in-context. Have your agent read this first if it's confused                                                       |
| `recommend`      | "I need X, here's my budget" → ranked providers with reasoning                                                                           |
| `compare`        | Side-by-side comparison of two providers                                                                                                 |

You don't have to call these directly. Your agent will pick them up.

---

## Troubleshooting

**"Missing or invalid API key" / 401**
You typed the key wrong, or the header name is wrong. It must be exactly `x-pl-key` and the value must start with `pl_`.

**"Quota exceeded" / 429**
You hit the per-minute cap (10 req/min on free tier). Wait 60 seconds. If you keep hitting it, batch your calls or ask the agent to slow down.

**Agent says it has no tools / can't see invariant**
Restart the AI client _fully_. Most clients only load MCP servers at startup — editing the config while the app is running does nothing.

**A specific provider returns "Not configured"**
That provider's upstream key isn't set on the gateway right now. Use `list_providers` to see what's actually live. The free, no-key providers (OpenFDA, CoinGecko, Mental Health) are always on.

**Where's my dashboard?**
https://pclabs.dev/dashboard — shows your quota, per-provider usage, and your key.

---

## Ideas to build (90 minutes is enough for any of these)

- **Market pulse dashboard** — BTC price + AAPL stock + Tokyo weather, refreshed every minute
- **Drug safety lookup** — paste a medication, get FDA adverse-event summary + recall history
- **Crisis resource finder** — chatbot that surfaces relevant mental health hotlines based on user input
- **"Should I take this med?"** — combine OpenFDA + your agent's reasoning for layperson explanations
- **Crypto news brief** — CoinGecko trending + 1-paragraph summary from your agent

---

## Need help?

Find one of us — **Usman, Sefika, Tobasum, or Fardeen**. We're hosting all day.
