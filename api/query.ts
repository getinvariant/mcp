import type { VercelRequest, VercelResponse } from "@vercel/node";
import { validatePlKey } from "../lib/auth.js";
import { getProvider } from "../lib/providers/registry.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = req.headers["x-pl-key"] as string;
  if (!validatePlKey(apiKey)) {
    return res.status(401).json({ error: "Invalid Procurement Labs API key" });
  }

  const { provider_id, action, params } = req.body;

  if (!provider_id || !action) {
    return res.status(400).json({ error: "Missing provider_id or action" });
  }

  const provider = getProvider(provider_id);
  if (!provider) {
    return res.status(404).json({ error: `Provider '${provider_id}' not found` });
  }

  if (!provider.isAvailable()) {
    return res.status(503).json({ error: `Provider '${provider.info.name}' is not configured on the server` });
  }

  const result = await provider.query(action, params || {});

  if (!result.success) {
    return res.status(502).json({ error: result.error });
  }

  return res.status(200).json({ data: result.data });
}
