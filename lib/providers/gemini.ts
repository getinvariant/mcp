import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

export class GeminiProvider implements Provider {
  info: ProviderInfo = {
    id: "gemini",
    name: "Google Gemini",
    category: ProviderCategory.AI,
    description:
      "Access Google Gemini AI models for text generation, analysis, and multimodal tasks.",
    availableActions: [
      {
        action: "chat",
        description: "Send a message to Gemini and get a response",
        parameters: {
          message: {
            type: "string",
            description: "The message to send",
            required: true,
          },
          model: {
            type: "string",
            description: "Model to use (default: gemini-1.5-flash)",
            required: false,
          },
        },
      },
    ],
    requiresApiKey: true,
  };

  isAvailable(): boolean {
    return !!process.env.GOOGLE_GEMINI_API_KEY;
  }

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey)
      return { success: false, error: "Google Gemini API key not configured" };

    if (action !== "chat")
      return { success: false, error: `Unknown action: ${action}` };

    const message = params.message as string;
    if (!message)
      return { success: false, error: "Missing required parameter: message" };

    const model = (params.model as string) || "gemini-1.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: message }] }],
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          error: `Gemini API error (${res.status}): ${text}`,
        };
      }

      const data = await res.json();
      return {
        success: true,
        data: {
          response: data.candidates?.[0]?.content?.parts?.[0]?.text,
          model,
          usage: data.usageMetadata,
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
