import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

export class UnsplashProvider implements Provider {
  info: ProviderInfo = {
    id: "unsplash",
    name: "Unsplash",
    category: ProviderCategory.CREATIVE,
    description:
      "Search and discover high-quality, royalty-free photos from Unsplash's library of 3M+ images.",
    availableActions: [
      {
        action: "photo_search",
        description: "Search for photos by keyword",
        parameters: {
          query: {
            type: "string",
            description: "Search term (e.g. 'mountains', 'office', 'abstract')",
            required: true,
          },
          per_page: {
            type: "number",
            description: "Results per page (default 10, max 30)",
            required: false,
          },
          orientation: {
            type: "string",
            description: "Filter by orientation: landscape, portrait, or squarish",
            required: false,
          },
          order_by: {
            type: "string",
            description: "Sort order: relevant (default) or latest",
            required: false,
          },
        },
      },
      {
        action: "random_photo",
        description: "Get a random photo, optionally filtered by topic",
        parameters: {
          query: {
            type: "string",
            description: "Optional topic filter (e.g. 'nature', 'technology')",
            required: false,
          },
          count: {
            type: "number",
            description: "Number of random photos (default 1, max 30)",
            required: false,
          },
        },
      },
      {
        action: "photo_details",
        description: "Get full details for a specific photo by ID",
        parameters: {
          id: {
            type: "string",
            description: "Unsplash photo ID",
            required: true,
          },
        },
      },
    ],
    requiresApiKey: true,
  };

  isAvailable(): boolean {
    return !!process.env.UNSPLASH_ACCESS_KEY;
  }

  private get accessKey(): string {
    return process.env.UNSPLASH_ACCESS_KEY || "";
  }

  private async usFetch(url: string): Promise<QueryResult> {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Client-ID ${this.accessKey}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          error: `Unsplash API error (${res.status}): ${text}`,
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

  private formatPhoto(p: any) {
    return {
      id: p.id,
      description: p.description || p.alt_description,
      photographer: p.user?.name,
      photographer_url: p.user?.links?.html,
      urls: {
        thumb: p.urls?.thumb,
        small: p.urls?.small,
        regular: p.urls?.regular,
        full: p.urls?.full,
      },
      width: p.width,
      height: p.height,
      color: p.color,
      likes: p.likes,
      download_url: p.links?.download,
      html_url: p.links?.html,
    };
  }

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    const base = "https://api.unsplash.com";

    switch (action) {
      case "photo_search": {
        const query = params.query as string;
        if (!query)
          return { success: false, error: "Missing required parameter: query" };

        const perPage = Math.min((params.per_page as number) || 10, 30);
        const qp = new URLSearchParams({
          query,
          per_page: String(perPage),
        });
        if (params.orientation) qp.set("orientation", params.orientation as string);
        if (params.order_by) qp.set("order_by", params.order_by as string);

        const result = await this.usFetch(`${base}/search/photos?${qp}`);
        if (!result.success) return result;
        const data = result.data as any;
        return {
          success: true,
          data: {
            total: data.total,
            results: data.results?.map((p: any) => this.formatPhoto(p)),
          },
        };
      }

      case "random_photo": {
        const count = Math.min((params.count as number) || 1, 30);
        const qp = new URLSearchParams({ count: String(count) });
        if (params.query) qp.set("query", params.query as string);

        const result = await this.usFetch(`${base}/photos/random?${qp}`);
        if (!result.success) return result;
        const data = result.data as any;
        const photos = Array.isArray(data) ? data : [data];
        return {
          success: true,
          data: photos.map((p: any) => this.formatPhoto(p)),
        };
      }

      case "photo_details": {
        const id = params.id as string;
        if (!id)
          return { success: false, error: "Missing required parameter: id" };

        const result = await this.usFetch(`${base}/photos/${encodeURIComponent(id)}`);
        if (!result.success) return result;
        return { success: true, data: this.formatPhoto(result.data) };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }
}
