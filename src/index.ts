#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { registerListProviders } from "./tools/list-providers.js";
import { registerQuery } from "./tools/query.js";

async function main() {
  if (!config.apiKey) {
    console.error("Error: PL_API_KEY environment variable is required.");
    console.error("Get your key at https://procurementlabs.up.railway.app");
    process.exit(1);
  }

  const server = new McpServer({
    name: "procurement-labs",
    version: "0.1.0",
  });

  registerListProviders(server);
  registerQuery(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
