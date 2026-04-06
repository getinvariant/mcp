import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateKey } from "../auth/keys.js";
import { getProvider } from "../providers/registry.js";
import { checkRateLimit, trackUsage } from "../usage/tracker.js";

export function registerQuery(server: McpServer): void {
  server.tool(
    "query",
    "Execute a real API call to a provisioned provider. You must provision the provider first using the 'provision' tool.",
    {
      provider_id: z.string().describe("The provider ID to query"),
      action: z.string().describe("The action to perform (see list_providers for available actions)"),
      params: z
        .record(z.unknown())
        .optional()
        .default({})
        .describe("Parameters for the action as a JSON object"),
      api_key: z.string().describe("Your Procurement Labs API key"),
    },
    async ({ provider_id, action, params, api_key }) => {
      const user = validateKey(api_key);
      if (!user) {
        return {
          content: [{ type: "text", text: "Invalid API key." }],
          isError: true,
        };
      }

      const provider = getProvider(provider_id);
      if (!provider) {
        return {
          content: [{ type: "text", text: `Provider '${provider_id}' not found.` }],
          isError: true,
        };
      }

      if (!user.provisionedProviders.includes(provider_id)) {
        return {
          content: [
            {
              type: "text",
              text: `Provider '${provider_id}' is not provisioned. Use the 'provision' tool first.`,
            },
          ],
          isError: true,
        };
      }

      const rateLimit = checkRateLimit(api_key);
      if (!rateLimit.allowed) {
        return {
          content: [
            {
              type: "text",
              text: `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.resetIn / 1000)} seconds.`,
            },
          ],
          isError: true,
        };
      }

      if (user.balance < provider.info.costPerQuery) {
        return {
          content: [
            {
              type: "text",
              text: `Insufficient balance. Need ${provider.info.costPerQuery} credits, have ${user.balance}.`,
            },
          ],
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

      trackUsage(api_key, provider_id, action, result.creditsUsed);

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
