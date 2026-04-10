#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { registerListProviders } from "./tools/list-providers.js";
import { registerRecommend } from "./tools/recommend.js";
import { registerGetApiDocs } from "./tools/get-api-docs.js";
import { registerCompare } from "./tools/compare.js";


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
  registerRecommend(server);
  registerGetApiDocs(server);
  registerCompare(server);


  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
