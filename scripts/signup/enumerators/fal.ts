// Fal.ai doesn't expose a public model-catalog API. We hand-curate the
// production media models that are part of their default offering. Each
// expands to a provider in our catalog. The single FAL_KEY authenticates
// them all.

import type { ProviderConfig } from "../lib/types.ts";

const FAL_MODELS = [
  "fal-ai/flux/dev",
  "fal-ai/flux/schnell",
  "fal-ai/flux-pro",
  "fal-ai/flux-pro/v1.1",
  "fal-ai/flux-pro/v1.1-ultra",
  "fal-ai/recraft-v3",
  "fal-ai/ideogram/v2",
  "fal-ai/stable-diffusion-v3-medium",
  "fal-ai/stable-diffusion-v35-large",
  "fal-ai/aura-flow",
  "fal-ai/playground-v25",
  "fal-ai/kolors",
  "fal-ai/luma-dream-machine",
  "fal-ai/luma-dream-machine/ray-2",
  "fal-ai/runway-gen3",
  "fal-ai/kling-video/v1/standard/text-to-video",
  "fal-ai/kling-video/v1.5/pro/text-to-video",
  "fal-ai/minimax-video",
  "fal-ai/mochi-v1",
  "fal-ai/hunyuan-video",
  "fal-ai/cogvideox-5b",
  "fal-ai/sadtalker",
  "fal-ai/whisper",
  "fal-ai/wizper",
  "fal-ai/elevenlabs",
  "fal-ai/cartesia/sonic",
  "fal-ai/stable-audio",
  "fal-ai/mmaudio-v2",
  "fal-ai/clarity-upscaler",
  "fal-ai/aura-sr",
  "fal-ai/creative-upscaler",
  "fal-ai/face-to-sticker",
  "fal-ai/birefnet",
  "fal-ai/imageutils/rembg",
  "fal-ai/ccsr",
  "fal-ai/codeformer",
  "fal-ai/photomaker",
  "fal-ai/pulid",
  "fal-ai/ip-adapter-face-id",
];

export async function enumerateFal(apiKey: string): Promise<ProviderConfig[]> {
  if (!apiKey) throw new Error("FAL_KEY not set");
  const now = new Date().toISOString();

  return FAL_MODELS.map((model) => ({
    id: `fal_${model.replace(/[\/:.]/g, "_").toLowerCase()}`,
    name: model,
    category: "ai",
    description: `${model} via fal.ai`,
    api_key: apiKey,
    base_url: `https://fal.run/${model}`,
    auth_header: "Authorization: Key {KEY}",
    source: "fal",
    sample_endpoint: {
      url: `https://fal.run/${model}`,
      method: "POST",
      headers: { Authorization: "Key {KEY}", "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a cat" }),
    },
    generated_at: now,
  }));
}
