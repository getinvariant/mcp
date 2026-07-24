// Generic provider that's instantiated from a JSON row in
// scripts/signup/data/generated-providers.json. One row → one Provider
// registered in the registry. This is how we scale from 22 hand-written
// providers to 500+ without writing 500 TS classes.

import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

interface GeneratedRow {
  id: string;
  name: string;
  category: string;
  description: string;
  api_key: string;
  base_url?: string;
  auth_header?: string;
  source: string;
  sample_endpoint?: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  smoke_ok?: boolean;
}

const CATEGORY_MAP: Record<string, ProviderCategory> = {
  ai: ProviderCategory.AI,
  weather: ProviderCategory.ENVIRONMENT,
  maps: ProviderCategory.MAPS,
  news: ProviderCategory.SOCIAL_IMPACT,
  finance: ProviderCategory.FINANCIAL,
  crypto: ProviderCategory.FINANCIAL,
  search: ProviderCategory.AI,
  media: ProviderCategory.CREATIVE,
  audio: ProviderCategory.CREATIVE,
  vector_db: ProviderCategory.CLOUD,
  email_infra: ProviderCategory.CLOUD,
  nlp: ProviderCategory.AI,
  utility: ProviderCategory.CLOUD,
};

function sub(template: string, key: string): string {
  return template.replace(/\{KEY\}/g, key);
}

export class GenericProvider implements Provider {
  info: ProviderInfo;
  private row: GeneratedRow;

  constructor(row: GeneratedRow) {
    this.row = row;
    this.info = {
      id: row.id,
      name: row.name,
      category: CATEGORY_MAP[row.category] ?? ProviderCategory.CLOUD,
      description: row.description,
      // The "default" action wraps the sample endpoint we know works. Routing
      // layer can extend this later with per-source action discovery.
      availableActions: [
        {
          action: "default",
          description: `Default endpoint for ${row.name}. Source: ${row.source}.`,
          parameters: {
            query: {
              type: "string",
              description: "Free-form query passed to the underlying API where applicable.",
              required: false,
            },
          },
        },
      ],
      requiresApiKey: true,
    };
  }

  isAvailable(): boolean {
    return Boolean(this.row.api_key) && this.row.smoke_ok !== false;
  }

  async query(
    action: string,
    _params: Record<string, unknown>,
  ): Promise<QueryResult> {
    if (action !== "default") {
      return { success: false, error: `Unknown action: ${action}` };
    }
    const endpoint = this.row.sample_endpoint;
    if (!endpoint) {
      return { success: false, error: "No sample endpoint defined for this provider" };
    }

    const key = this.row.api_key;
    const url = sub(endpoint.url, key);
    const headers: Record<string, string> = {};
    if (endpoint.headers) {
      for (const [h, v] of Object.entries(endpoint.headers)) headers[h] = sub(v, key);
    }
    const body = endpoint.body ? sub(endpoint.body, key) : undefined;

    try {
      const res = await fetch(url, {
        method: endpoint.method || "GET",
        headers,
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      const data = (() => {
        try { return JSON.parse(text); } catch { return text; }
      })();
      if (!res.ok) return { success: false, error: `${this.row.name} ${res.status}`, data };
      return { success: true, data };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}

export function loadGeneratedProviders(rows: GeneratedRow[]): Provider[] {
  return rows.map((r) => new GenericProvider(r));
}
