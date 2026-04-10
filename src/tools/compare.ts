import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { backendRequest } from "../client.js";

export function registerCompare(server: McpServer): void {
  server.tool(
    "compare",
    "Compare two or more providers side by side on pricing, rate limits, strengths, weaknesses, and capabilities.",
    {
      provider_ids: z
        .array(z.string())
        .min(2)
        .describe("Provider IDs to compare — e.g. ['claude', 'gemini']"),
    },
    async ({ provider_ids }) => {
      const result = await backendRequest("mcp", "POST", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "compare", arguments: { provider_ids } },
      });

      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const response = result.data as any;
      return response?.result ?? {
        content: [{ type: "text", text: "No response from server" }],
        isError: true,
      };
    }
  );
}
