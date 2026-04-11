import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

export class ArtInstituteProvider implements Provider {
  info: ProviderInfo = {
    id: "art_institute",
    name: "Art Institute of Chicago",
    category: ProviderCategory.CREATIVE,
    description:
      "Search the Art Institute of Chicago's collection of 120,000+ artworks — paintings, sculptures, photographs, and more. No API key required.",
    availableActions: [
      {
        action: "artwork_search",
        description: "Search artworks by keyword, artist, or style",
        parameters: {
          query: {
            type: "string",
            description:
              "Search term (e.g. 'Monet', 'impressionism', 'landscape')",
            required: true,
          },
          limit: {
            type: "number",
            description: "Max results (default 10, max 100)",
            required: false,
          },
        },
      },
      {
        action: "artwork_details",
        description: "Get full details for a specific artwork by ID",
        parameters: {
          id: {
            type: "number",
            description: "Artwork ID number",
            required: true,
          },
        },
      },
      {
        action: "artist_search",
        description: "Search for artists in the collection",
        parameters: {
          query: {
            type: "string",
            description: "Artist name to search",
            required: true,
          },
          limit: {
            type: "number",
            description: "Max results (default 10)",
            required: false,
          },
        },
      },
    ],
    requiresApiKey: false,
  };

  isAvailable(): boolean {
    return true;
  }

  private async aicFetch(url: string): Promise<QueryResult> {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          error: `Art Institute API error (${res.status}): ${text}`,
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

  private formatArtwork(a: any, iiifBase?: string) {
    const imageUrl =
      a.image_id && iiifBase
        ? `${iiifBase}/${a.image_id}/full/843,/0/default.jpg`
        : null;

    return {
      id: a.id,
      title: a.title,
      artist: a.artist_display || a.artist_title,
      date: a.date_display,
      medium: a.medium_display,
      dimensions: a.dimensions,
      department: a.department_title,
      classification: a.classification_title,
      style: a.style_title,
      image_url: imageUrl,
      web_url: `https://www.artic.edu/artworks/${a.id}`,
      is_public_domain: a.is_public_domain,
    };
  }

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    const base = "https://api.artic.edu/api/v1";

    switch (action) {
      case "artwork_search": {
        const query = params.query as string;
        if (!query)
          return { success: false, error: "Missing required parameter: query" };

        const limit = Math.min((params.limit as number) || 10, 100);
        const fields =
          "id,title,artist_display,artist_title,date_display,medium_display,dimensions,department_title,classification_title,style_title,image_id,is_public_domain";

        const result = await this.aicFetch(
          `${base}/artworks/search?q=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`,
        );
        if (!result.success) return result;
        const data = result.data as any;
        const iiifBase = data.config?.iiif_url;
        return {
          success: true,
          data: data.data?.map((a: any) => this.formatArtwork(a, iiifBase)),
        };
      }

      case "artwork_details": {
        const id = params.id as number;
        if (!id)
          return { success: false, error: "Missing required parameter: id" };

        const result = await this.aicFetch(`${base}/artworks/${id}`);
        if (!result.success) return result;
        const data = result.data as any;
        const iiifBase = data.config?.iiif_url;
        return {
          success: true,
          data: this.formatArtwork(data.data, iiifBase),
        };
      }

      case "artist_search": {
        const query = params.query as string;
        if (!query)
          return { success: false, error: "Missing required parameter: query" };

        const limit = Math.min((params.limit as number) || 10, 100);
        const result = await this.aicFetch(
          `${base}/artists/search?q=${encodeURIComponent(query)}&limit=${limit}`,
        );
        if (!result.success) return result;
        const data = result.data as any;
        return {
          success: true,
          data: data.data?.map((a: any) => ({
            id: a.id,
            title: a.title,
            birth_date: a.birth_date,
            death_date: a.death_date,
            description: a.description,
          })),
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }
}
