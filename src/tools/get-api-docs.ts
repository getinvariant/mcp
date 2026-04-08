import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { backendRequest } from "../client.js";

export function registerGetApiDocs(server: McpServer): void {
  server.tool(
    "get_api_docs",
    "View the full API integration documentation — authentication, available REST endpoints, provider categories, and example requests. Read this before building an integration.",
    {
      section: z
        .enum(["overview", "authentication", "endpoints", "providers"])
        .optional()
        .describe("Narrow to a specific section (optional — omit for full docs)"),
    },
    async ({ section }) => {
      const result = await backendRequest("mcp", "POST", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_api_docs", arguments: { section } },
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
