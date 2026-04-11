import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

export class AnthropicProvider implements Provider {
  info: ProviderInfo = {
    id: "claude",
    name: "Anthropic Claude",
    category: ProviderCategory.AI,
    description:
      "Access Claude AI models for text generation, analysis, summarization, and reasoning.",
    availableActions: [
      {
        action: "chat",
        description: "Send a message to Claude and get a response",
        parameters: {
          message: {
            type: "string",
            description: "The message to send to Claude",
            required: true,
          },
          model: {
            type: "string",
            description: "Model to use (default: claude-haiku-4-5-20251001)",
            required: false,
          },
          max_tokens: {
            type: "number",
            description: "Max tokens in response (default: 1024)",
            required: false,
          },
        },
      },
    ],
    requiresApiKey: true,
  };

  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey)
      return { success: false, error: "Anthropic API key not configured" };

    if (action !== "chat")
      return { success: false, error: `Unknown action: ${action}` };

    const message = params.message as string;
    if (!message)
      return { success: false, error: "Missing required parameter: message" };

    const model = (params.model as string) || "claude-haiku-4-5-20251001";
    const max_tokens = (params.max_tokens as number) || 1024;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens,
          messages: [{ role: "user", content: message }],
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          error: `Anthropic API error (${res.status}): ${text}`,
        };
      }

      const data = await res.json();
      return {
        success: true,
        data: {
          response: data.content?.[0]?.text,
          model: data.model,
          usage: data.usage,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Request failed: ${(err as Error).message}`,
      };
    }
  }
}
