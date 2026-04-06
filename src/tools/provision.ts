import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateKey } from "../auth/keys.js";
import { addProvision } from "../auth/store.js";
import { getProvider } from "../providers/registry.js";

export function registerProvision(server: McpServer): void {
  server.tool(
    "provision",
    "Activate a provider for your account so you can query its APIs. You must provision a provider before querying it.",
    {
      provider_id: z.string().describe("The provider ID to provision (e.g., 'openfda', 'alpha_vantage')"),
      api_key: z.string().describe("Your Procurement Labs API key"),
    },
    async ({ provider_id, api_key }) => {
      const user = validateKey(api_key);
      if (!user) {
        return {
          content: [{ type: "text", text: "Invalid API key. Please provide a valid Procurement Labs API key." }],
          isError: true,
        };
      }

      const provider = getProvider(provider_id);
      if (!provider) {
        return {
          content: [{ type: "text", text: `Provider '${provider_id}' not found. Use list_providers to see available providers.` }],
          isError: true,
        };
      }

      if (user.provisionedProviders.includes(provider_id)) {
        return {
          content: [{ type: "text", text: `Provider '${provider.info.name}' is already provisioned for your account.` }],
        };
      }

      addProvision(api_key, provider_id);

      const actions = provider.info.availableActions
        .map((a) => `  - ${a.action}: ${a.description}`)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: [
              `Successfully provisioned ${provider.info.name}!`,
              `Cost per query: ${provider.info.costPerQuery} credits`,
              `Your balance: ${user.balance} credits`,
              ``,
              `Available actions:`,
              actions,
              ``,
              `Use the 'query' tool with provider_id='${provider_id}' to make API calls.`,
            ].join("\n"),
          },
        ],
      };
    }
  );
}
