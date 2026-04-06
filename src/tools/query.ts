import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProvider } from "../providers/registry.js";

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
      const provider = getProvider(provider_id);
      if (!provider) {
        return {
          content: [{ type: "text", text: `Provider '${provider_id}' not found. Use list_providers to see available providers.` }],
          isError: true,
        };
      }

      if (!provider.isAvailable()) {
        return {
          content: [{ type: "text", text: `Provider '${provider.info.name}' is not configured. The required API key has not been set up.` }],
          isError: true,
        };
      }

      const result = await provider.query(action, params);

      if (!result.success) {
        return {
          content: [{ type: "text", text: `Query failed: ${result.error}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    }
  );
}
