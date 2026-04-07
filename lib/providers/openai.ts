import { Provider, ProviderCategory, ProviderInfo, QueryResult } from "./types.js";

export class OpenAIProvider implements Provider {
  info: ProviderInfo = {
    id: "openai",
    name: "OpenAI",
    category: ProviderCategory.AI,
    description: "Access GPT models for chat, embeddings, and text generation.",
    availableActions: [
      {
        action: "chat",
        description: "Send a message to a GPT model and get a response",
        parameters: {
          message: { type: "string", description: "The message to send", required: true },
          model: { type: "string", description: "Model to use (default: gpt-4o-mini)", required: false },
          max_tokens: { type: "number", description: "Max tokens in response (default: 1024)", required: false },
        },
      },
      {
        action: "embed",
        description: "Generate an embedding vector for a piece of text",
        parameters: {
          text: { type: "string", description: "Text to embed", required: true },
          model: { type: "string", description: "Embedding model (default: text-embedding-3-small)", required: false },
        },
      },
    ],
    requiresApiKey: true,
  };

  isAvailable(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async query(action: string, params: Record<string, unknown>): Promise<QueryResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { success: false, error: "OpenAI API key not configured" };

    switch (action) {
      case "chat": {
        const message = params.message as string;
        if (!message) return { success: false, error: "Missing required parameter: message" };
        const model = (params.model as string) || "gpt-4o-mini";
        const max_tokens = (params.max_tokens as number) || 1024;

        try {
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              max_tokens,
              messages: [{ role: "user", content: message }],
            }),
          });
          if (!res.ok) {
            const text = await res.text();
            return { success: false, error: `OpenAI API error (${res.status}): ${text}` };
          }
          const data = await res.json();
          return {
            success: true,
            data: {
              response: data.choices?.[0]?.message?.content,
              model: data.model,
              usage: data.usage,
            },
          };
        } catch (err) {
          return { success: false, error: `Request failed: ${(err as Error).message}` };
        }
      }

      case "embed": {
        const text = params.text as string;
        if (!text) return { success: false, error: "Missing required parameter: text" };
        const model = (params.model as string) || "text-embedding-3-small";

        try {
          const res = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model, input: text }),
          });
          if (!res.ok) {
            const text = await res.text();
            return { success: false, error: `OpenAI API error (${res.status}): ${text}` };
          }
          const data = await res.json();
          return {
            success: true,
            data: {
              embedding: data.data?.[0]?.embedding,
              model: data.model,
              usage: data.usage,
            },
          };
        } catch (err) {
          return { success: false, error: `Request failed: ${(err as Error).message}` };
        }
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }
}
