import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { backendRequest } from "../client.js";

export function registerQuery(server: McpServer): void {
  server.tool(
    "query",
    "Execute a real API call to any available provider. Use list_providers to see available providers and their actions.",
    {
      provider_id: z.string().describe("The provider ID to query (e.g., 'openfda', 'alpha_vantage', 'mental_health', 'charity', 'environment')"),
      action: z.string().describe("The action to perform (see list_providers for available actions per provider)"),
      params: z
        .record(z.unknown())
        .optional()
        .default({})
        .describe("Parameters for the action as a JSON object"),
    },
    async ({ provider_id, action, params }) => {
      const result = await backendRequest("query", "POST", {
        provider_id,
        action,
        params,
      });

      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const { data } = result.data as { data: unknown };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );
}
