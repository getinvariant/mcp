import type { VercelRequest, VercelResponse } from "@vercel/node";
import { validatePlKey } from "./_lib/auth.js";
import { getAllProviders } from "./_lib/providers/registry.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = req.headers["x-pl-key"] as string;
  if (!validatePlKey(apiKey)) {
    return res.status(401).json({ error: "Invalid Procurement Labs API key" });
  }

  const category = req.query.category as string | undefined;
  let providers = getAllProviders();

  if (category) {
    providers = providers.filter((p) => p.info.category === category);
  }

  return res.status(200).json({
    providers: providers.map((p) => ({
      ...p.info,
      available: p.isAvailable(),
    })),
  });
}
