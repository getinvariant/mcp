// OpenRouter exposes every routed LLM through one key. We treat each model as
// its own provider in the catalog so the routing layer can pick between them
// the same way it picks between standalone vendors.

import type { ProviderConfig } from "../lib/types.ts";

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt: string; completion: string };
}

export async function enumerateOpenRouter(apiKey: string): Promise<ProviderConfig[]> {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenRouter /models returned ${res.status}`);

  const body = (await res.json()) as { data: OpenRouterModel[] };
  const now = new Date().toISOString();

  return body.data.map((m) => {
    const safeId = m.id.replace(/[\/:.]/g, "_").toLowerCase();
    return {
      id: `openrouter_${safeId}`,
      name: m.name || m.id,
      category: "ai",
      description:
        m.description?.slice(0, 240) ||
        `${m.name || m.id} via OpenRouter. Context ${m.context_length ?? "?"} tokens.`,
      api_key: apiKey,
      base_url: "https://openrouter.ai/api/v1",
      auth_header: "Authorization: Bearer {KEY}",
      source: "openrouter",
      sample_endpoint: {
        url: "https://openrouter.ai/api/v1/chat/completions",
        method: "POST",
        headers: { Authorization: "Bearer {KEY}", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: m.id,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 4,
        }),
      },
      generated_at: now,
    };
  });
}
