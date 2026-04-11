import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

export class OpenLibraryProvider implements Provider {
  info: ProviderInfo = {
    id: "open_library",
    name: "Open Library",
    category: ProviderCategory.EDUCATION,
    description:
      "Search millions of books, get detailed editions, and access author info via the Internet Archive's Open Library.",
    availableActions: [
      {
        action: "book_search",
        description: "Search for books by title, author, or subject",
        parameters: {
          query: {
            type: "string",
            description: "Search query (title, author, or general terms)",
            required: true,
          },
          type: {
            type: "string",
            description:
              "Search type: 'general' (default), 'title', 'author', or 'subject'",
            required: false,
          },
          limit: {
            type: "number",
            description: "Max results (default 10)",
            required: false,
          },
        },
      },
      {
        action: "book_details",
        description: "Get detailed information about a specific book by ISBN or Open Library ID",
        parameters: {
          isbn: {
            type: "string",
            description: "ISBN-10 or ISBN-13",
            required: false,
          },
          olid: {
            type: "string",
            description: "Open Library work ID (e.g. OL45883W)",
            required: false,
          },
        },
      },
      {
        action: "author_search",
        description: "Search for authors by name",
        parameters: {
          name: {
            type: "string",
            description: "Author name to search",
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

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    const base = "https://openlibrary.org";

    switch (action) {
      case "book_search": {
        const query = params.query as string;
        if (!query)
          return { success: false, error: "Missing required parameter: query" };

        const limit = Math.min((params.limit as number) || 10, 50);
        const type = (params.type as string) || "general";

        let url: string;
        switch (type) {
          case "title":
            url = `${base}/search.json?title=${encodeURIComponent(query)}&limit=${limit}`;
            break;
          case "author":
            url = `${base}/search.json?author=${encodeURIComponent(query)}&limit=${limit}`;
            break;
          case "subject":
            url = `${base}/search.json?subject=${encodeURIComponent(query)}&limit=${limit}`;
            break;
          default:
            url = `${base}/search.json?q=${encodeURIComponent(query)}&limit=${limit}`;
        }

        return this.olFetch(url, (data: any) =>
          data.docs?.map((doc: any) => ({
            title: doc.title,
            authors: doc.author_name,
            first_publish_year: doc.first_publish_year,
            isbn: doc.isbn?.[0],
            subjects: doc.subject?.slice(0, 5),
            cover_id: doc.cover_i,
            olid: doc.key,
            edition_count: doc.edition_count,
          })),
        );
      }

      case "book_details": {
        const isbn = params.isbn as string;
        const olid = params.olid as string;

        if (isbn) {
          return this.olFetch(
            `${base}/isbn/${encodeURIComponent(isbn)}.json`,
          );
        }
        if (olid) {
          const path = olid.startsWith("/") ? olid : `/works/${olid}`;
          return this.olFetch(`${base}${path}.json`);
        }
        return {
          success: false,
          error: "Provide either 'isbn' or 'olid' parameter",
        };
      }

      case "author_search": {
        const name = params.name as string;
        if (!name)
          return { success: false, error: "Missing required parameter: name" };

        const limit = Math.min((params.limit as number) || 10, 50);
        return this.olFetch(
          `${base}/search/authors.json?q=${encodeURIComponent(name)}&limit=${limit}`,
          (data: any) =>
            data.docs?.map((a: any) => ({
              name: a.name,
              key: a.key,
              birth_date: a.birth_date,
              top_work: a.top_work,
              work_count: a.work_count,
            })),
        );
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  private async olFetch(
    url: string,
    transform?: (data: any) => any,
  ): Promise<QueryResult> {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          error: `Open Library API error (${res.status}): ${text}`,
        };
      }
      const data = await res.json();
      return { success: true, data: transform ? transform(data) : data };
    } catch (err) {
      return {
        success: false,
        error: `Request failed: ${(err as Error).message}`,
      };
    }
  }
}
