import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

export class GoogleCloudProvider implements Provider {
  info: ProviderInfo = {
    id: "google_cloud",
    name: "Google Cloud Translation",
    category: ProviderCategory.CLOUD,
    description:
      "Google Cloud Translation API — translate text between 100+ languages and detect language.",
    availableActions: [
      {
        action: "translate",
        description: "Translate text to a target language",
        parameters: {
          text: {
            type: "string",
            description: "Text to translate",
            required: true,
          },
          target: {
            type: "string",
            description: "Target language code (e.g., 'es', 'fr', 'zh')",
            required: true,
          },
          source: {
            type: "string",
            description: "Source language code (auto-detected if omitted)",
            required: false,
          },
        },
      },
      {
        action: "detect_language",
        description: "Detect the language of a piece of text",
        parameters: {
          text: {
            type: "string",
            description: "Text to detect language for",
            required: true,
          },
        },
      },
    ],
    requiresApiKey: true,
  };

  isAvailable(): boolean {
    return !!process.env.GOOGLE_CLOUD_API_KEY;
  }

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
    if (!apiKey)
      return { success: false, error: "Google Cloud API key not configured" };

    const base = `https://translation.googleapis.com/language/translate/v2`;

    switch (action) {
      case "translate": {
        const text = params.text as string;
        const target = params.target as string;
        if (!text || !target)
          return {
            success: false,
            error: "Missing required parameters: text, target",
          };

        const body: Record<string, unknown> = {
          q: text,
          target,
          format: "text",
        };
        if (params.source) body.source = params.source;

        try {
          const res = await fetch(`${base}?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const errText = await res.text();
            return {
              success: false,
              error: `Google Cloud error (${res.status}): ${errText}`,
            };
          }
          const data = await res.json();
          const translation = data.data?.translations?.[0];
          return {
            success: true,
            data: {
              translated_text: translation?.translatedText,
              detected_source_language: translation?.detectedSourceLanguage,
              target_language: target,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Request failed: ${(err as Error).message}`,
          };
        }
      }

      case "detect_language": {
        const text = params.text as string;
        if (!text)
          return { success: false, error: "Missing required parameter: text" };

        try {
          const res = await fetch(`${base}/detect?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ q: text }),
          });
          if (!res.ok) {
            const errText = await res.text();
            return {
              success: false,
              error: `Google Cloud error (${res.status}): ${errText}`,
            };
          }
          const data = await res.json();
          return { success: true, data: data.data?.detections?.[0]?.[0] };
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
