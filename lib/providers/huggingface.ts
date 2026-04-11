import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

export class HuggingFaceProvider implements Provider {
  info: ProviderInfo = {
    id: "huggingface",
    name: "HuggingFace Inference",
    category: ProviderCategory.AI,
    description:
      "Run open-source AI models via HuggingFace Inference API — text generation, classification, and more.",
    availableActions: [
      {
        action: "text_generation",
        description: "Generate text using a HuggingFace model",
        parameters: {
          prompt: {
            type: "string",
            description: "Input text prompt",
            required: true,
          },
          model: {
            type: "string",
            description:
              "Model ID (default: mistralai/Mistral-7B-Instruct-v0.2)",
            required: false,
          },
          max_new_tokens: {
            type: "number",
            description: "Max tokens to generate (default: 256)",
            required: false,
          },
        },
      },
      {
        action: "text_classification",
        description: "Classify text using a sentiment or classification model",
        parameters: {
          text: {
            type: "string",
            description: "Text to classify",
            required: true,
          },
          model: {
            type: "string",
            description:
              "Model ID (default: distilbert/distilbert-base-uncased-finetuned-sst-2-english)",
            required: false,
          },
        },
      },
    ],
    requiresApiKey: true,
  };

  isAvailable(): boolean {
    return !!process.env.HUGGINGFACE_API_KEY;
  }

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    const apiKey = process.env.HUGGINGFACE_API_KEY;
    if (!apiKey)
      return { success: false, error: "HuggingFace API key not configured" };

    switch (action) {
      case "text_generation": {
        const prompt = params.prompt as string;
        if (!prompt)
          return {
            success: false,
            error: "Missing required parameter: prompt",
          };
        const model =
          (params.model as string) || "mistralai/Mistral-7B-Instruct-v0.2";
        const max_new_tokens = (params.max_new_tokens as number) || 256;
        const url = `https://api-inference.huggingface.co/models/${model}`;

        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              inputs: prompt,
              parameters: { max_new_tokens },
            }),
          });
          if (!res.ok) {
            const text = await res.text();
            return {
              success: false,
              error: `HuggingFace API error (${res.status}): ${text}`,
            };
          }
          const data = await res.json();
          return { success: true, data };
        } catch (err) {
          return {
            success: false,
            error: `Request failed: ${(err as Error).message}`,
          };
        }
      }

      case "text_classification": {
        const text = params.text as string;
        if (!text)
          return { success: false, error: "Missing required parameter: text" };
        const model =
          (params.model as string) ||
          "distilbert/distilbert-base-uncased-finetuned-sst-2-english";
        const url = `https://api-inference.huggingface.co/models/${model}`;

        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ inputs: text }),
          });
          if (!res.ok) {
            const text = await res.text();
            return {
              success: false,
              error: `HuggingFace API error (${res.status}): ${text}`,
            };
          }
          const data = await res.json();
          return { success: true, data };
        } catch (err) {
          return {
            success: false,
            error: `Request failed: ${(err as Error).message}`,
          };
        }
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }
}
