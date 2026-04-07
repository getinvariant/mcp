import { validatePlKey } from "../lib/auth.js";
import { getAllProviders, getProvider } from "../lib/providers/registry.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = req.headers["x-pl-key"] as string;
  if (!validatePlKey(apiKey)) {
    return res.status(401).json({ error: "Invalid Procurement Labs API key" });
  }

  const body = req.body;

  // Handle batch requests
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map(handleMessage))).filter(Boolean);
    if (responses.length === 0) return res.status(202).end();
    return res.status(200).json(responses.length === 1 ? responses[0] : responses);
  }

  const response = await handleMessage(body);
  if (response === null) return res.status(202).end();
  return res.status(200).json(response);
}

async function handleMessage(msg: any): Promise<object | null> {
  const { id, method, params } = msg;
  const isNotification = !("id" in msg);

  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "procurement-labs", version: "0.1.0" },
      });

    case "ping":
      return ok({});

    case "tools/list":
      return ok({
        tools: [
          {
            name: "list_providers",
            description:
              "Browse all available API providers. Optionally filter by category: physical_health, mental_health, financial, social_impact, environment, ai, maps, cloud.",
            inputSchema: {
              type: "object",
              properties: {
                category: { type: "string", description: "Filter by category" },
              },
            },
          },
          {
            name: "query",
            description:
              "Execute a real API call to any available provider. Use list_providers first to see available providers and their actions.",
            inputSchema: {
              type: "object",
              properties: {
                provider_id: {
                  type: "string",
                  description: "The provider ID (e.g. 'openfda', 'alpha_vantage', 'claude')",
                },
                action: { type: "string", description: "The action to perform" },
                params: {
                  type: "object",
                  description: "Parameters for the action",
                },
              },
              required: ["provider_id", "action"],
            },
          },
        ],
      });

    case "tools/call": {
      const { name, arguments: args = {} } = params || {};

      if (name === "list_providers") {
        const category = args.category as string | undefined;
        let providers = getAllProviders();
        if (category) {
          providers = providers.filter((p) => p.info.category === category);
        }

        if (providers.length === 0) {
          return ok({
            content: [
              { type: "text", text: `No providers found${category ? ` for category: ${category}` : ""}.` },
            ],
          });
        }

        const lines = providers.map((p) => {
          const actions = p.info.availableActions
            .map((a) => {
              const paramStr = Object.entries(a.parameters)
                .map(([k, v]) => `${k} (${v.type}${v.required ? ", required" : ""})`)
                .join(", ");
              return `    - ${a.action}: ${a.description} [${paramStr}]`;
            })
            .join("\n");
          return [
            `## ${p.info.name} (${p.info.id})`,
            `Category: ${p.info.category}`,
            `Status: ${p.isAvailable() ? "Ready" : "Not configured"}`,
            `Description: ${p.info.description}`,
            `Actions:\n${actions}`,
          ].join("\n");
        });

        return ok({ content: [{ type: "text", text: lines.join("\n\n---\n\n") }] });
      }

      if (name === "query") {
        const { provider_id, action, params: queryParams = {} } = args;

        if (!provider_id || !action) {
          return ok({ content: [{ type: "text", text: "Error: Missing provider_id or action" }], isError: true });
        }

        const provider = getProvider(provider_id);
        if (!provider) {
          return ok({
            content: [{ type: "text", text: `Error: Provider '${provider_id}' not found` }],
            isError: true,
          });
        }

        if (!provider.isAvailable()) {
          return ok({
            content: [
              { type: "text", text: `Error: Provider '${provider.info.name}' is not configured on the server` },
            ],
            isError: true,
          });
        }

        const result = await provider.query(action, queryParams);

        if (!result.success) {
          return ok({ content: [{ type: "text", text: `Error: ${result.error}` }], isError: true });
        }

        return ok({ content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] });
      }

      return err(-32601, `Unknown tool: ${name}`);
    }

    default:
      if (isNotification) return null;
      return err(-32601, `Method not found: ${method}`);
  }
}
