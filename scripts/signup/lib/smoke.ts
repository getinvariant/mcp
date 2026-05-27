// Lightweight smoke tester for a provider config. Substitutes {KEY} into the
// URL, headers, and body before issuing the request. Counts a 2xx OR a 401/403
// as "key not yet active" (still worth keeping the row, will warm up later).
// Anything else is a hard failure.

import type { ProviderConfig, SmokeTest } from "./types.ts";

function sub(template: string, key: string): string {
  return template.replace(/\{KEY\}/g, key);
}

export async function smokeTest(
  config: ProviderConfig,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const test: SmokeTest | undefined = config.sample_endpoint;
  if (!test) return { ok: true }; // No test defined — treat as pass.

  const key = config.api_key;
  const url = sub(test.url, key);
  const headers: Record<string, string> = {};
  if (test.headers) {
    for (const [h, v] of Object.entries(test.headers)) {
      headers[h] = sub(v, key);
    }
  }
  const body = test.body ? sub(test.body, key) : undefined;

  try {
    const res = await fetch(url, {
      method: test.method || "GET",
      headers,
      body,
      // Short timeout: most APIs respond in <2s. Slow ones probably broken.
      signal: AbortSignal.timeout(8_000),
    });

    if (res.ok) return { ok: true, status: res.status };

    if (test.expect_body_contains) {
      const text = await res.text();
      if (text.includes(test.expect_body_contains))
        return { ok: true, status: res.status };
    }

    // Treat auth-flavored errors as "live but needs activation" — not dead.
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, error: "auth_pending" };
    }
    return { ok: false, status: res.status, error: `http_${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
