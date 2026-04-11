import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

export class KhanAcademyProvider implements Provider {
  info: ProviderInfo = {
    id: "khan_academy",
    name: "Khan Academy",
    category: ProviderCategory.EDUCATION,
    description:
      "Browse Khan Academy's free educational content tree — subjects, courses, units, and lessons across math, science, computing, and more.",
    availableActions: [
      {
        action: "topic_tree",
        description:
          "Get the top-level subject areas or drill into a specific topic slug",
        parameters: {
          slug: {
            type: "string",
            description:
              "Topic slug to drill into (e.g. 'math', 'science', 'computing'). Omit for top-level subjects.",
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
    if (action !== "topic_tree") {
      return { success: false, error: `Unknown action: ${action}` };
    }

    const slug = params.slug as string | undefined;
    const url = slug
      ? `https://www.khanacademy.org/api/v1/topic/${encodeURIComponent(slug)}`
      : "https://www.khanacademy.org/api/v1/topictree?kind=Topic&depth=1";

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const text = await res.text();
        return {
          success: false,
          error: `Khan Academy API error (${res.status}): ${text}`,
        };
      }
      const data = await res.json();

      if (slug) {
        return {
          success: true,
          data: {
            title: data.title,
            slug: data.slug,
            description: data.description,
            children: data.children?.map((c: any) => ({
              title: c.title,
              slug: c.slug,
              kind: c.kind,
              url: c.ka_url || c.url,
            })),
          },
        };
      }

      const children = data.children || [];
      return {
        success: true,
        data: children
          .filter((c: any) => c.kind === "Topic")
          .map((c: any) => ({
            title: c.title,
            slug: c.slug,
            description: c.description?.slice(0, 200),
            child_count: c.children?.length || 0,
          })),
      };
    } catch (err) {
      return {
        success: false,
        error: `Request failed: ${(err as Error).message}`,
      };
    }
  }
}
