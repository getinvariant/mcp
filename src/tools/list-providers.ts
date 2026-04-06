import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAllProviders } from "../providers/registry.js";

export function registerListProviders(server: McpServer): void {
  server.tool(
    "list_providers",
    "Browse all available API providers. Optionally filter by category: physical_health, mental_health, financial, social_impact, environment.",
    {
      category: z.string().optional().describe("Filter by category"),
    },
    async ({ category }) => {
      let providers = getAllProviders();

      if (category) {
        providers = providers.filter((p) => p.info.category === category);
      }

      if (providers.length === 0) {
        return {
          content: [{ type: "text", text: `No providers found${category ? ` for category: ${category}` : ""}.` }],
        };
      }

      const lines = providers.map((p) => {
        const actions = p.info.availableActions.map((a) => `    - ${a.action}: ${a.description}`).join("\n");
        return [
          `## ${p.info.name} (${p.info.id})`,
          `Category: ${p.info.category}`,
          `Description: ${p.info.description}`,
          `Cost: ${p.info.costPerQuery} credits/query`,
          `Rate limit: ${p.info.rateLimitPerMinute} req/min`,
          `API key required: ${p.info.requiresApiKey ? "Yes" : "No"}`,
          `Actions:\n${actions}`,
        ].join("\n");
      });

      return {
        content: [{ type: "text", text: lines.join("\n\n---\n\n") }],
      };
    }
  );
}
