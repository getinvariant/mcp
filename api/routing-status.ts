import { authenticateRequest } from "../lib/auth.js";
import { getStatus } from "../lib/routing/router.js";
import { renderStatus } from "../lib/routing/render.js";

export interface RoutingStatusResponse {
  task_type: string;
  account_id: string;
  calls_routed: number;
  providers: {
    name: string;
    success_rate: number;
    ok: number;
    total: number;
    avg_latency_ms: number;
  }[];
  ascii: string;
}

export async function handleRoutingStatus(
  accountId: string,
  taskType: string,
): Promise<RoutingStatusResponse> {
  const status = await getStatus(accountId, taskType);
  const ascii = renderStatus({
    task_type: taskType,
    account_id: accountId,
    providers: status.providers,
    events: status.events,
  });
  return {
    task_type: taskType,
    account_id: accountId,
    calls_routed: status.calls_routed,
    providers: status.providers,
    ascii,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await authenticateRequest(req.headers["x-pl-key"] as string);
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }
  res.setHeader("X-RateLimit-Remaining", String(auth.remaining ?? 0));

  const taskType =
    (req.query?.task_type as string | undefined) || "finance:price";
  const out = await handleRoutingStatus(auth.account!.id, taskType);
  return res.status(200).json(out);
}
