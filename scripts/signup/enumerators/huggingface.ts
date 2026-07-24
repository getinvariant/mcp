// Hugging Face has thousands of models. We pull the top trending inference-API
// enabled models across the major pipelines so the catalog covers text, image,
// audio, and embedding generation without bloating to thousands of entries.

import type { ProviderConfig } from "../lib/types.ts";

const PIPELINES = [
  "text-generation",
  "text-to-image",
  "automatic-speech-recognition",
  "text-to-speech",
  "feature-extraction",
  "image-to-text",
  "translation",
  "summarization",
];

const PER_PIPELINE_LIMIT = 8;

interface HFModel {
  id: string;
  pipeline_tag?: string;
  downloads?: number;
  likes?: number;
}

export async function enumerateHuggingFace(apiKey: string): Promise<ProviderConfig[]> {
  if (!apiKey) throw new Error("HUGGINGFACE_API_KEY not set");

  const out: ProviderConfig[] = [];
  const now = new Date().toISOString();

  for (const pipeline of PIPELINES) {
    const url = `https://huggingface.co/api/models?pipeline_tag=${pipeline}&sort=downloads&direction=-1&limit=${PER_PIPELINE_LIMIT}&inference_provider=hf-inference`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      console.warn(`HuggingFace pipeline ${pipeline} returned ${res.status} — skipping`);
      continue;
    }
    const models = (await res.json()) as HFModel[];
    for (const m of models) {
      const safeId = m.id.replace(/[\/:.]/g, "_").toLowerCase();
      out.push({
        id: `hf_${safeId}`,
        name: m.id,
        category: "ai",
        description: `${m.id} via Hugging Face Inference (${pipeline}). ${m.downloads ?? 0} downloads.`,
        api_key: apiKey,
        base_url: `https://api-inference.huggingface.co/models/${m.id}`,
        auth_header: "Authorization: Bearer {KEY}",
        source: "huggingface",
        sample_endpoint: {
          url: `https://api-inference.huggingface.co/models/${m.id}`,
          method: "POST",
          headers: { Authorization: "Bearer {KEY}", "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: "hello" }),
        },
        generated_at: now,
      });
    }
  }
  return out;
}
