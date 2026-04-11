import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { backendRequest } from "../client.js";

export function registerListProviders(server: McpServer): void {
  server.tool(
    "list_providers",
    "Browse all available API providers. Optionally filter by category: physical_health, mental_health, financial, social_impact, environment.",
    {
      category: z.string().optional().describe("Filter by category"),
    },
    async ({ category }) => {
      const query = category
        ? `providers?category=${encodeURIComponent(category)}`
        : "providers";
      const result = await backendRequest(query, "GET");

      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const { providers } = result.data as { providers: any[] };

      if (!providers || providers.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No providers found${category ? ` for category: ${category}` : ""}.`,
            },
          ],
        };
      }

      const lines = providers.map((p: any) => {
        const actions = p.availableActions
          .map((a: any) => {
            const params = Object.entries(a.parameters)
              .map(
                ([k, v]: [string, any]) =>
                  `${k} (${v.type}${v.required ? ", required" : ""})`,
              )
              .join(", ");
            return `    - ${a.action}: ${a.description} [${params}]`;
          })
          .join("\n");
        const status = p.available ? "Ready" : "Not configured";
        return [
          `## ${p.name} (${p.id})`,
          `Category: ${p.category}`,
          `Status: ${status}`,
          `Description: ${p.description}`,
          `Actions:\n${actions}`,
        ].join("\n");
      });

      return {
        content: [{ type: "text", text: lines.join("\n\n---\n\n") }],
      };
    },
  );
}
