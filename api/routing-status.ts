import { getAccount } from "../lib/db.js";
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
  events: {
    call_index: number;
    provider: string;
    success: boolean;
    rates_after: Record<string, number>;
    latency_ms: number | null;
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
    events: status.events,
    ascii,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth without rate-limit increment -- this is a read-only monitoring
  // endpoint polled every 2s by the viz dashboard, not an API call.
  const plKey = req.headers["x-pl-key"] as string | undefined;
  if (!plKey || !plKey.startsWith("pl_")) {
    return res.status(401).json({ error: "Missing or invalid API key" });
  }
  const account = await getAccount(plKey);
  if (!account) {
    return res.status(401).json({ error: "Unknown API key" });
  }

  const taskType =
    (req.query?.task_type as string | undefined) || "finance:price";
  const out = await handleRoutingStatus(account.id, taskType);
  return res.status(200).json(out);
}
