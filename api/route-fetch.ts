import { authenticateRequest } from "../lib/auth.js";
import { getProvider } from "../lib/providers/registry.js";
import { selectProvider, recordOutcome } from "../lib/routing/router.js";
import { transformPlacesResponse } from "../lib/transforms/places.js";

// Tiny region lookup. First substring hit wins. Rough but real signal.
const REGION_KEYWORDS: { keys: string[]; region: string }[] = [
  { keys: ["san francisco", "sf", "bay area"], region: "us-west" },
  { keys: ["new york", "nyc", "brooklyn"], region: "us-east" },
  { keys: ["tokyo", "osaka", "kyoto"], region: "asia-east" },
  { keys: ["mumbai", "delhi", "bangalore"], region: "asia-south" },
  { keys: ["lagos", "nairobi", "cairo"], region: "africa" },
  { keys: ["paris", "london", "berlin", "madrid"], region: "europe-west" },
];

function deriveContext(text: string): string {
  const t = text.toLowerCase();
  for (const { keys, region } of REGION_KEYWORDS) {
    for (const k of keys) {
      if (t.includes(k)) return region;
    }
  }
  return "global";
}

export interface RouteFetchResponse {
  ok: boolean;
  status: number;
  body: any;
  routed_to: string;
  original: string;
  call_index: number;
  context: string;
  rates_after: Record<string, number>;
}

export async function handleRouteFetch(
  accountId: string,
  source: "geoapify" | "mapbox",
  task_type: string,
  params: any,
): Promise<RouteFetchResponse> {
  const context = deriveContext(String(params.text ?? ""));
  const { chosen } = await selectProvider(accountId, task_type, context);
  const provider = getProvider(chosen);

  let success = false;
  let status = 500;
  let routedBody: any = null;
  let latencyMs = 0;
  const start = Date.now();
  try {
    const raw = await provider!.query("geocode", {
      text: String(params.text),
    });
    latencyMs = Date.now() - start;
    success = !!raw.success;
    status = success ? 200 : 502;
    routedBody = raw.success
      ? raw.data
      : { error: raw.error ?? "provider error" };
  } catch (e: any) {
    latencyMs = Date.now() - start;
    routedBody = { error: e?.message ?? String(e) };
  }

  const body = success
    ? transformPlacesResponse(routedBody, chosen, source)
    : routedBody;

  const { rates_after, call_index } = await recordOutcome({
    accountId,
    taskType: task_type,
    provider: chosen,
    success,
    latencyMs,
    context,
  });

  return {
    ok: success,
    status,
    body,
    routed_to: chosen,
    original: source,
    call_index,
    context,
    rates_after,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await authenticateRequest(req.headers["x-pl-key"] as string);
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }
  res.setHeader("X-RateLimit-Remaining", String(auth.remaining ?? 0));

  const body = req.body ?? {};
  const { source, task_type, params } = body;
  if (!source || !task_type || !params) {
    return res
      .status(400)
      .json({ error: "source, task_type, params required" });
  }

  try {
    const out = await handleRouteFetch(
      auth.account!.id,
      source,
      task_type,
      params,
    );
    return res.status(200).json(out);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? String(e) });
  }
}
