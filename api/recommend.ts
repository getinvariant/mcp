import { authenticateRequest } from "../lib/auth.js";
import { bureauRecommend } from "../lib/bureau.js";

export default async function handler(req: any, res: any) {
  let category = "maps";
  if (req.method === "GET") {
    category = (req.query?.category as string | undefined) || "maps";
  } else if (req.method === "POST") {
    category = (req.body?.category as string | undefined) || "maps";
  } else {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await authenticateRequest(
    req.headers["x-pl-key"] as string,
    req.headers["authorization"] as string | undefined,
  );
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }

  const result = await bureauRecommend(category);
  return res.status(200).json(result);
}
