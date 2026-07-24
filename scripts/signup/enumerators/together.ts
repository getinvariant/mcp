// Together AI exposes all served models through /v1/models. We include them
// all — even the embedding and reranker variants — because the routing layer
// benefits from knowing which model fits which task.

import type { ProviderConfig } from "../lib/types.ts";

interface TogetherModel {
  id: string;
  display_name?: string;
  description?: string;
  type?: string;
  context_length?: number;
}

export async function enumerateTogether(apiKey: string): Promise<ProviderConfig[]> {
  if (!apiKey) throw new Error("TOGETHER_API_KEY not set");

  const res = await fetch("https://api.together.xyz/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Together /models returned ${res.status}`);

  const models = (await res.json()) as TogetherModel[];
  const now = new Date().toISOString();

  return models.map((m) => {
    const safeId = m.id.replace(/[\/:.]/g, "_").toLowerCase();
    const isChat = m.type === "chat" || !m.type;
    return {
      id: `together_${safeId}`,
      name: m.display_name || m.id,
      category: "ai",
      description: (m.description || `${m.id} via Together AI`).slice(0, 240),
      api_key: apiKey,
      base_url: "https://api.together.xyz/v1",
      auth_header: "Authorization: Bearer {KEY}",
      source: "together",
      sample_endpoint: isChat
        ? {
            url: "https://api.together.xyz/v1/chat/completions",
            method: "POST",
            headers: { Authorization: "Bearer {KEY}", "Content-Type": "application/json" },
            body: JSON.stringify({
              model: m.id,
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 4,
            }),
          }
        : {
            url: "https://api.together.xyz/v1/embeddings",
            method: "POST",
            headers: { Authorization: "Bearer {KEY}", "Content-Type": "application/json" },
            body: JSON.stringify({ model: m.id, input: "hello" }),
          },
      generated_at: now,
    };
  });
}
