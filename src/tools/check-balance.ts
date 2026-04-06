import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateKey } from "../auth/keys.js";
import { checkRateLimit } from "../usage/tracker.js";
import { getProvider } from "../providers/registry.js";

export function registerCheckBalance(server: McpServer): void {
  server.tool(
    "check_balance",
    "Check your current credit balance, usage history, and rate limit status.",
    {
      api_key: z.string().describe("Your Procurement Labs API key"),
    },
    async ({ api_key }) => {
      const user = validateKey(api_key);
      if (!user) {
        return {
          content: [{ type: "text", text: "Invalid API key." }],
          isError: true,
        };
      }

      const rateLimit = checkRateLimit(api_key);

      const provisionedList = user.provisionedProviders
        .map((id) => {
          const p = getProvider(id);
          return p ? `  - ${p.info.name} (${id})` : `  - ${id}`;
        })
        .join("\n") || "  None";

      const usageSummary = new Map<string, { count: number; credits: number }>();
      for (const entry of user.usage) {
        const key = entry.providerId;
        const existing = usageSummary.get(key) || { count: 0, credits: 0 };
        existing.count++;
        existing.credits += entry.creditsUsed;
        usageSummary.set(key, existing);
      }

      const usageLines = usageSummary.size > 0
        ? Array.from(usageSummary.entries())
            .map(([id, s]) => `  - ${id}: ${s.count} queries, ${s.credits} credits`)
            .join("\n")
        : "  No usage yet";

      const text = [
        `## Account Summary`,
        `Name: ${user.name}`,
        `Balance: ${user.balance} credits`,
        `Total used: ${user.totalUsed} credits`,
        ``,
        `## Rate Limit`,
        `Remaining this window: ${rateLimit.remaining} requests`,
        `Window resets in: ${Math.ceil(rateLimit.resetIn / 1000)}s`,
        ``,
        `## Provisioned Providers`,
        provisionedList,
        ``,
        `## Usage by Provider`,
        usageLines,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    }
  );
}
