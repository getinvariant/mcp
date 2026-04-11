import { config } from "./config.js";

export async function backendRequest(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const url = `${config.backendUrl}/api/${path}`;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-pl-key": config.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json();

    if (!res.ok) {
      return { ok: false, error: json.error || `HTTP ${res.status}` };
    }

    return { ok: true, data: json };
  } catch (err) {
    return {
      ok: false,
      error: `Backend request failed: ${(err as Error).message}`,
    };
  }
}
