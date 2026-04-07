import { authenticateRequest } from "../lib/auth.js";
import { recommend, compareProviders } from "../lib/reasoning/engine.js";
import type { Priority } from "../lib/reasoning/types.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await authenticateRequest(req.headers["x-pl-key"] as string);
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }

  const { action } = req.body;

  if (action === "compare") {
    // Compare specific providers side by side
    const { provider_ids } = req.body;
    if (!Array.isArray(provider_ids) || provider_ids.length < 2) {
      return res.status(400).json({ error: "Provide at least 2 provider_ids to compare" });
    }
    const comparison = compareProviders(provider_ids);
    return res.status(200).json({ data: comparison });
  }

  // Default: recommend providers for a need
  const { need, priorities, budget } = req.body;

  if (!need || typeof need !== "string") {
    return res.status(400).json({ error: "Missing 'need' — describe what you're building or what data you need" });
  }

  const validPriorities: Priority[] = ["cost", "reliability", "speed", "data-quality", "no-auth"];
  const safePriorities = (priorities || []).filter((p: string) => validPriorities.includes(p as Priority));

  const recommendations = recommend({
    need,
    priorities: safePriorities,
    budget: ["free", "low", "any"].includes(budget) ? budget : "any",
  });

  return res.status(200).json({
    data: {
      query: need,
      priorities: safePriorities,
      budget: budget || "any",
      recommendations,
      total: recommendations.length,
    },
  });
}
