import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { getAllProviders } from "../lib/providers/registry.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await authenticateRequest(req.headers["x-pl-key"] as string);
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: auth.error });
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
