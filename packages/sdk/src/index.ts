import { parseRequest } from "./parse.js";
import type { InstallOpts, RouteFetchResponse } from "./types.js";

const INTERCEPT_HOSTS = new Set([
  "api.geoapify.com",
  "api.mapbox.com",
  "nominatim.openstreetmap.org",
]);

let originalFetch: typeof fetch | null = null;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function installInvariant(opts: InstallOpts): void {
  if (originalFetch) return;
  const base = (opts.base_url ?? "http://localhost:3000").replace(/\/$/, "");
  const pl_key = opts.pl_key;
  originalFetch = globalThis.fetch.bind(globalThis);
  const orig = originalFetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return orig(input as any, init);
    }
    if (!INTERCEPT_HOSTS.has(host)) return orig(input as any, init);

    const parsed = parseRequest(url, init);
    if (!parsed) return orig(input as any, init);

    try {
      const res = await orig(`${base}/api/route-fetch`, {
        method: "POST",
        headers: { "x-pl-key": pl_key, "content-type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        console.warn(`[invariant] backend ${res.status}, falling back`);
        return orig(input as any, init);
      }
      const data = (await res.json()) as RouteFetchResponse;
      return new Response(JSON.stringify(data.body), {
        status: data.status,
        headers: {
          "content-type": "application/json",
          "x-invariant-routed-to": data.routed_to,
          "x-invariant-original": data.original,
          "x-invariant-call-index": String(data.call_index),
          "x-invariant-context": data.context,
        },
      });
    } catch (e) {
      console.warn(`[invariant] route-fetch failed, falling back:`, e);
      return orig(input as any, init);
    }
  }) as typeof fetch;
}

export function uninstallInvariant(): void {
  if (!originalFetch) return;
  globalThis.fetch = originalFetch;
  originalFetch = null;
}
