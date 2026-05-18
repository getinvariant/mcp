import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.env.PL_BACKEND_URL ?? 'http://localhost:3000';

function detectKey(): string | undefined {
  // 1. Explicit env var wins
  if (process.env.PL_API_KEY) return process.env.PL_API_KEY;

  // 2. Read from ~/.cursor/mcp.json — key embedded as ?token= in the URL
  const sources = [
    join(homedir(), '.cursor', 'mcp.json'),
    join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
  ];
  for (const src of sources) {
    try {
      const cfg = JSON.parse(readFileSync(src, 'utf8'));
      const servers = cfg?.mcpServers ?? {};
      for (const s of Object.values(servers) as any[]) {
        // Check headers first (preferred — set by Cursor deep link)
        const headerKey = s?.headers?.['x-pl-key'];
        if (headerKey) return headerKey;
        // Fall back to ?token= in URL
        try {
          const token = new URL(s?.url ?? '').searchParams.get('token');
          if (token) return token;
        } catch {}
      }
    } catch {}
  }
  return undefined;
}

const API_KEY = detectKey();

interface Provider {
  name: string;
  success_rate: number;
  ok: number;
  total: number;
  avg_latency_ms: number;
}

interface RoutingEvent {
  call_index: number;
  provider: string;
  success: boolean;
  rates_after: Record<string, number>;
}

interface RoutingStatus {
  task_type: string;
  account_id: string;
  calls_routed: number;
  providers: Provider[];
  events: RoutingEvent[];
  ascii: string;
}

type StatusMap = Record<string, RoutingStatus | null>;

const TASK_TYPES = ['finance:price', 'places:geocode'];

async function fetchStatus(taskType: string): Promise<RoutingStatus | null> {
  const url = `${BASE_URL}/api/routing-status?task_type=${encodeURIComponent(taskType)}`;
  try {
    const headers: Record<string, string> = {};
    if (API_KEY) headers['x-pl-key'] = API_KEY;

    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return (await res.json()) as RoutingStatus;
  } catch {
    return null;
  }
}

function computeROI(status: RoutingStatus): { failuresAvoided: number; latencySavedMs: number } {
  let failuresAvoided = 0;
  let latencySavedMs = 0;

  const providerLatencyMap: Record<string, number> = {};
  for (const p of status.providers) {
    providerLatencyMap[p.name] = p.avg_latency_ms;
  }

  const worstLatency = Math.max(...status.providers.map((p) => p.avg_latency_ms), 0);

  for (const e of status.events) {
    // Failures avoided
    const chosenRate = e.rates_after[e.provider] ?? 0;
    const otherRates = Object.entries(e.rates_after)
      .filter(([name]) => name !== e.provider)
      .map(([, rate]) => rate);

    if (otherRates.length > 0) {
      const avgOtherRate = otherRates.reduce((a, b) => a + b, 0) / otherRates.length;
      const diff = chosenRate - avgOtherRate;
      if (diff > 0) failuresAvoided += diff;
    }

    // Latency saved
    const chosenLatency = providerLatencyMap[e.provider] ?? 0;
    const saved = worstLatency - chosenLatency;
    if (saved > 0) latencySavedMs += saved;
  }

  return { failuresAvoided, latencySavedMs };
}

function boxed(text: string): string {
  const padding = 4;
  const inner = ' '.repeat(padding) + text + ' '.repeat(padding);
  const width = inner.length;
  const border = '─'.repeat(width);
  return `┌${border}┐\n│${inner}│\n└${border}┘`;
}

function renderSection(status: RoutingStatus): string {
  const lines: string[] = [];

  // Task type label
  lines.push(`\x1b[36m▸ ${status.task_type}\x1b[0m  (${status.calls_routed} calls routed)`);
  lines.push('');

  // Server-rendered ASCII (sparklines + dolphin)
  if (status.ascii) {
    lines.push(status.ascii);
  }

  // ROI block
  const { failuresAvoided, latencySavedMs } = computeROI(status);
  lines.push('');
  lines.push('\x1b[33m  ┌─ ROI snapshot ──────────────────────┐\x1b[0m');
  lines.push(`\x1b[33m  │  failures avoided : \x1b[32m${failuresAvoided.toFixed(1).padStart(6)}\x1b[33m            │\x1b[0m`);
  lines.push(`\x1b[33m  │  latency saved    : \x1b[32m${String(Math.round(latencySavedMs)).padStart(4)}ms\x1b[33m          │\x1b[0m`);
  lines.push('\x1b[33m  └─────────────────────────────────────┘\x1b[0m');

  return lines.join('\n');
}

function formatTime(d: Date): string {
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

function render(data: StatusMap): void {
  process.stdout.write('\x1Bc');

  // Header
  const header = boxed('INVARIANT · ROUTING INTELLIGENCE');
  console.log('\x1b[1m\x1b[35m' + header + '\x1b[0m');
  console.log('');

  const anyData = TASK_TYPES.some((t) => data[t] !== null && data[t] !== undefined);

  if (!anyData) {
    console.log('  connecting...');
  } else {
    for (const taskType of TASK_TYPES) {
      const status = data[taskType];
      if (!status) {
        console.log(`\x1b[36m▸ ${taskType}\x1b[0m  \x1b[31m(no data)\x1b[0m`);
      } else {
        console.log(renderSection(status));
      }
      console.log('');
    }
  }

  // Footer
  const now = formatTime(new Date());
  console.log(`\x1b[2m  last updated: ${now} · polling every 2s\x1b[0m`);
}

async function poll(data: StatusMap): Promise<void> {
  const results = await Promise.allSettled(TASK_TYPES.map((t) => fetchStatus(t)));
  for (let i = 0; i < TASK_TYPES.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      data[TASK_TYPES[i]] = r.value;
    }
  }
  render(data);
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('\x1b[31mError: PL_API_KEY environment variable is not set.\x1b[0m');
    console.error('Set it in your .env file or export it before running this script.');
    process.exit(1);
  }

  const data: StatusMap = {};
  for (const t of TASK_TYPES) data[t] = null;

  // Show "connecting..." immediately
  render(data);

  // First fetch
  await poll(data);

  // Then poll every 2s
  setInterval(() => {
    poll(data).catch(() => {});
  }, 2000);
}

main().catch((err) => {
  console.error('\x1b[31mFatal error:\x1b[0m', err);
  process.exit(1);
});
