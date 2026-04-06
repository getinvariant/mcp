import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initializeRegistry } from "./providers/registry.js";
import { seedDemoUser } from "./auth/store.js";
import { registerListProviders } from "./tools/list-providers.js";
import { registerProvision } from "./tools/provision.js";
import { registerQuery } from "./tools/query.js";
import { registerCheckBalance } from "./tools/check-balance.js";

async function main() {
  // Seed demo user
  seedDemoUser();

  // Initialize provider registry
  await initializeRegistry();

  // Create MCP server
  const server = new McpServer({
    name: "procurement-labs",
    version: "0.1.0",
  });

  // Register tools
  registerListProviders(server);
  registerProvision(server);
  registerQuery(server);
  registerCheckBalance(server);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
