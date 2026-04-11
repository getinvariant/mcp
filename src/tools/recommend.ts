import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { backendRequest } from "../client.js";

export function registerRecommend(server: McpServer): void {
  server.tool(
    "recommend",
    "Get intelligent recommendations for which API provider to use based on your needs. Compares pricing, rate limits, reliability, and capabilities.",
    {
      need: z
        .string()
        .describe(
          "Describe what you need — e.g. 'I need real-time stock prices'",
        ),
      priorities: z
        .array(
          z.enum(["cost", "reliability", "speed", "data-quality", "no-auth"]),
        )
        .optional()
        .describe("What matters most to you"),
      budget: z
        .enum(["free", "low", "any"])
        .optional()
        .describe("Budget constraint"),
    },
    async ({ need, priorities, budget }) => {
      const result = await backendRequest("mcp", "POST", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "recommend", arguments: { need, priorities, budget } },
      });

      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const response = result.data as any;
      return (
        response?.result ?? {
          content: [{ type: "text", text: "No response from server" }],
          isError: true,
        }
      );
    },
  );
}
