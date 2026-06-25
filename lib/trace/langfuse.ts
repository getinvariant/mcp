// Langfuse tracing for the credit bureau. CLAUDE.md wants every bureau request
// wrapped as ONE trace with spans for route-decision, accuracy-judgment,
// x402-payment, and downgrade. This module is a thin, throw-safe wrapper:
// when Langfuse env is unset every method is a no-op, so the request path never
// depends on the tracer being configured.

import { Langfuse } from "langfuse";

let _client: Langfuse | null = null;

export function langfuseEnabled(): boolean {
  return !!(
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
  );
}

function client(): Langfuse | null {
  if (!langfuseEnabled()) return null;
  if (_client) return _client;
  _client = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_HOST,
  });
  return _client;
}

// A minimal span surface so callers don't touch the raw SDK. Both real spans
// and the no-op stub satisfy it.
export interface BureauSpan {
  end(output?: unknown): void;
}

export interface BureauTrace {
  span(name: string, input?: unknown): BureauSpan;
  /** Record a whole span in one shot (start + end) — for instantaneous events. */
  event(name: string, input?: unknown, output?: unknown): void;
  update(output: unknown): void;
  /** Flush to Langfuse; safe to await in a fire-and-forget tail. */
  flush(): Promise<void>;
}

const NOOP_SPAN: BureauSpan = { end() {} };
const NOOP_TRACE: BureauTrace = {
  span: () => NOOP_SPAN,
  event() {},
  update() {},
  flush: async () => {},
};

/** Open a bureau trace. Returns a no-op trace when Langfuse is unconfigured. */
export function startTrace(
  name: string,
  meta: { accountId?: string; input?: unknown; metadata?: Record<string, unknown> } = {},
): BureauTrace {
  const lf = client();
  if (!lf) return NOOP_TRACE;
  try {
    const trace = lf.trace({
      name,
      userId: meta.accountId,
      input: meta.input,
      metadata: meta.metadata,
    });
    return {
      span(spanName, input) {
        try {
          const s = trace.span({ name: spanName, input });
          return {
            end(output) {
              try {
                s.end({ output });
              } catch {
                /* tracing must never break the request */
              }
            },
          };
        } catch {
          return NOOP_SPAN;
        }
      },
      event(eventName, input, output) {
        try {
          trace.span({ name: eventName, input }).end({ output });
        } catch {
          /* ignore */
        }
      },
      update(output) {
        try {
          trace.update({ output });
        } catch {
          /* ignore */
        }
      },
      async flush() {
        try {
          await lf.flushAsync();
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    return NOOP_TRACE;
  }
}
