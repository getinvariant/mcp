// Replicate's /v1/models endpoint paginates through hundreds of public models.
// We pull the first few pages, ranked by recent runs, to surface the popular
// community models (FLUX, SDXL, Whisper variants, MusicGen, etc.).

import type { ProviderConfig } from "../lib/types.ts";

const MAX_PAGES = 4; // ~100 models, plenty.

interface ReplicateModel {
  url: string;
  owner: string;
  name: string;
  description?: string;
  visibility: string;
  run_count?: number;
  latest_version?: { id: string };
}

interface ReplicatePage {
  next: string | null;
  results: ReplicateModel[];
}

export async function enumerateReplicate(apiKey: string): Promise<ProviderConfig[]> {
  if (!apiKey) throw new Error("REPLICATE_API_TOKEN not set");

  const out: ProviderConfig[] = [];
  const now = new Date().toISOString();
  let nextUrl: string | null = "https://api.replicate.com/v1/models";

  for (let page = 0; page < MAX_PAGES && nextUrl; page++) {
    const res: Response = await fetch(nextUrl, {
      headers: { Authorization: `Token ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Replicate /models returned ${res.status}`);
    const body = (await res.json()) as ReplicatePage;

    for (const m of body.results) {
      if (m.visibility !== "public" || !m.latest_version) continue;
      const fullName = `${m.owner}/${m.name}`;
      out.push({
        id: `replicate_${fullName.replace(/[\/:.]/g, "_").toLowerCase()}`,
        name: fullName,
        category: "ai",
        description: (m.description || `${fullName} on Replicate`).slice(0, 240),
        api_key: apiKey,
        base_url: "https://api.replicate.com/v1",
        auth_header: "Authorization: Token {KEY}",
        source: "replicate",
        sample_endpoint: {
          url: "https://api.replicate.com/v1/predictions",
          method: "POST",
          headers: { Authorization: "Token {KEY}", "Content-Type": "application/json" },
          body: JSON.stringify({
            version: m.latest_version.id,
            input: { prompt: "hello" },
          }),
        },
        generated_at: now,
      });
    }
    nextUrl = body.next;
  }

  return out;
}
