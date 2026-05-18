// SDK-side trace: in-memory log of intercepted calls, inline per-call line,
// and a closing duck panel when the process exits.

const FRAMES: string[] = [
  `       __
   ___( o)>
   \\_____/
   ~~~~~~~~~`,
  `       __
   ___( o)>
   \\,___,/
   ~~~~~~~~~`,
  `       __
   ___( o)>
   \\\`___\`/
   ~~~~~~~~~`,
];

export type TraceEvent = {
  source: string;
  routed_to: string;
  context: string;
  call_index: number;
  latency_ms: number;
  success: boolean;
};

const events: TraceEvent[] = [];
let verbose = false;
let exitHookInstalled = false;

const C = {
  yellow: "\x1b[38;2;255;255;0m",
  blue: "\x1b[38;2;88;196;221m",
  green: "\x1b[38;2;131;193;103m",
  red: "\x1b[38;2;252;98;85m",
  dim: "\x1b[38;2;120;120;120m",
  reset: "\x1b[0m",
};

export function setVerbose(v: boolean): void {
  verbose = v;
  if (
    v &&
    !exitHookInstalled &&
    typeof process !== "undefined" &&
    typeof process.on === "function"
  ) {
    process.on("exit", () => {
      try {
        printInvariantTrace();
      } catch {
        /* ignore */
      }
    });
    exitHookInstalled = true;
  }
}

export function pushEvent(e: TraceEvent): void {
  events.push(e);
  if (!verbose) return;
  const arrow = `${C.yellow}▸ invariant${C.reset}`;
  const flow = `${C.dim}${e.source}${C.reset} → ${C.blue}${e.routed_to}${C.reset}`;
  const meta = `${C.dim}${e.context} · #${e.call_index} · ${e.latency_ms}ms${C.reset}`;
  const tail = e.success ? "" : `  ${C.red}FAIL${C.reset}`;
  console.log(`  ${arrow}  ${flow} · ${meta}${tail}`);
}

export function getTrace(): readonly TraceEvent[] {
  return events;
}

export function printInvariantTrace(): void {
  if (events.length === 0) return;

  const frame = FRAMES[(((events.length - 1) % 3) + 3) % 3];

  const byProvider = new Map<
    string,
    { count: number; totalLatency: number; ok: number }
  >();
  for (const e of events) {
    const cur = byProvider.get(e.routed_to) ?? {
      count: 0,
      totalLatency: 0,
      ok: 0,
    };
    cur.count += 1;
    cur.totalLatency += e.latency_ms;
    if (e.success) cur.ok += 1;
    byProvider.set(e.routed_to, cur);
  }

  const contexts = Array.from(new Set(events.map((e) => e.context))).join(", ");

  const lines: string[] = [];
  lines.push("");
  lines.push(`${C.yellow}${frame}${C.reset}`);
  lines.push("");
  lines.push(
    `  ${C.yellow}invariant${C.reset}${C.dim}  ${events.length} calls routed  ·  ${contexts}${C.reset}`,
  );
  lines.push("");

  for (const [name, s] of byProvider) {
    const avg = Math.round(s.totalLatency / s.count);
    const rate = s.ok / s.count;
    const rateColor = rate === 1 ? C.green : rate >= 0.5 ? C.yellow : C.red;
    lines.push(
      `  ${C.blue}${name.padEnd(14)}${C.reset}` +
        `${String(s.count).padStart(3)}  ` +
        `${rateColor}${(rate * 100).toFixed(0).padStart(3)}%${C.reset}  ` +
        `${C.dim}${String(avg).padStart(4)}ms avg${C.reset}`,
    );
  }

  lines.push("");
  console.log(lines.join("\n"));
}
