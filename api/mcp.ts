import { authenticateRequest } from "../lib/auth.js";
import { getAllProviders } from "../lib/providers/registry.js";
import { recommend, compareProviders } from "../lib/reasoning/engine.js";
import { buildApiDocs } from "../lib/docs.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await authenticateRequest(req.headers["x-pl-key"] as string);
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }

  const body = req.body;

  // Handle batch requests
  if (Array.isArray(body)) {
    const accountId = auth.account!.id;
    const responses = (
      await Promise.all(body.map((m: any) => handleMessage(m, accountId)))
    ).filter(Boolean);
    if (responses.length === 0) return res.status(202).end();
    return res
      .status(200)
      .json(responses.length === 1 ? responses[0] : responses);
  }

  const response = await handleMessage(body, auth.account!.id);
  if (response === null) return res.status(202).end();
  return res.status(200).json(response);
}

async function handleMessage(
  msg: any,
  accountId: string,
): Promise<object | null> {
  const { id, method, params } = msg;
  const isNotification = !("id" in msg);

  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });

  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "invariant", version: "0.1.0" },
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
            name: "get_api_docs",
            description:
              "View the full API integration documentation — authentication, available REST endpoints, provider categories, and example requests. Read this before building an integration.",
            inputSchema: {
              type: "object",
              properties: {
                section: {
                  type: "string",
                  enum: [
                    "overview",
                    "authentication",
                    "endpoints",
                    "providers",
                    "multi-key",
                  ],
                  description:
                    "Narrow to a specific section (optional — omit for full docs)",
                },
              },
            },
          },
          {
            name: "recommend",
            description:
              "Get intelligent recommendations for which API provider to use based on your needs. Compares pricing, rate limits, reliability, and capabilities.",
            inputSchema: {
              type: "object",
              properties: {
                need: {
                  type: "string",
                  description:
                    "Describe what you need — e.g. 'I need real-time stock prices'",
                },
                priorities: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: [
                      "cost",
                      "reliability",
                      "speed",
                      "data-quality",
                      "no-auth",
                    ],
                  },
                  description: "What matters most to you",
                },
                budget: {
                  type: "string",
                  enum: ["free", "low", "any"],
                  description: "Budget constraint",
                },
              },
              required: ["need"],
            },
          },
          {
            name: "compare",
            description:
              "Compare two or more providers side by side on pricing, rate limits, strengths, weaknesses, and capabilities.",
            inputSchema: {
              type: "object",
              properties: {
                provider_ids: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 2,
                  description:
                    "Provider IDs to compare — e.g. ['claude', 'gemini']",
                },
              },
              required: ["provider_ids"],
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
              {
                type: "text",
                text: `No providers found${category ? ` for category: ${category}` : ""}.`,
              },
            ],
          });
        }

        const lines = providers.map((p) => {
          const actions = p.info.availableActions
            .map((a) => {
              const paramStr = Object.entries(a.parameters)
                .map(
                  ([k, v]) =>
                    `${k} (${v.type}${v.required ? ", required" : ""})`,
                )
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

        return ok({
          content: [{ type: "text", text: lines.join("\n\n---\n\n") }],
        });
      }

      if (name === "get_api_docs") {
        const { section } = args;
        const docs = buildApiDocs(section);
        return ok({ content: [{ type: "text", text: docs }] });
      }

      if (name === "recommend") {
        const { need, priorities, budget } = args;
        if (!need) {
          return ok({
            content: [
              { type: "text", text: "Error: Missing 'need' parameter" },
            ],
            isError: true,
          });
        }
        const results = recommend({ need, priorities, budget });
        if (results.length === 0) {
          return ok({
            content: [
              {
                type: "text",
                text: "No matching providers found. Try rephrasing or use list_providers to browse all available APIs.",
              },
            ],
          });
        }
        const text = results
          .map((r: any, i: number) =>
            [
              `## ${i + 1}. ${r.provider_name} (${r.provider_id}) — Score: ${r.score}/100`,
              `${r.reasoning}`,
              `Actions: ${r.actions.join(", ")}`,
              `Pricing: ${r.pricing.model}${r.pricing.freeTier ? ` (free tier: ${r.pricing.freeTier})` : ""}`,
              `Rate limits: ${r.rateLimits.free || "N/A"}`,
              `Available: ${r.available ? "✅ Ready" : "❌ Needs API key"}`,
            ].join("\n"),
          )
          .join("\n\n---\n\n");
        return ok({ content: [{ type: "text", text }] });
      }

      if (name === "compare") {
        const { provider_ids } = args;
        if (!Array.isArray(provider_ids) || provider_ids.length < 2) {
          return ok({
            content: [
              { type: "text", text: "Error: Provide at least 2 provider_ids" },
            ],
            isError: true,
          });
        }
        const results = compareProviders(provider_ids);
        if (results.length === 0) {
          return ok({
            content: [{ type: "text", text: "No matching providers found." }],
            isError: true,
          });
        }
        return ok({
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        });
      }

      return err(-32601, `Unknown tool: ${name}`);
    }

    default:
      if (isNotification) return null;
      return err(-32601, `Method not found: ${method}`);
  }
}
