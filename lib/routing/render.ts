type Event = {
  call_index: number;
  provider: string;
  success: boolean;
  rates_after: Record<string, number>;
};

type Provider = {
  name: string;
  success_rate: number;
  ok: number;
  total: number;
  avg_latency_ms: number;
};

const BLOCKS = "▁▂▃▄▅▆▇█";

function sparkline(values: number[], width = 40): string {
  if (values.length === 0) return " ".repeat(width);
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    const idx = Math.floor((i / width) * values.length);
    const v = Math.max(0, Math.min(1, values[idx]));
    out.push(
      BLOCKS[Math.min(BLOCKS.length - 1, Math.floor(v * BLOCKS.length))],
    );
  }
  return out.join("");
}

export function renderStatus(args: {
  task_type: string;
  account_id: string;
  providers: Provider[];
  events: Event[];
}): string {
  const { task_type, providers, events, account_id } = args;
  const tag = account_id.slice(0, 8);

  const lines: string[] = [];
  lines.push(`Invariant — Routing Intelligence  (account: ${tag})`);
  lines.push(``);
  lines.push(`Task: ${task_type}    Calls routed: ${events.length}`);
  lines.push(``);

  for (const p of providers) {
    const series = events
      .filter((e) => e.rates_after && e.rates_after[p.name] !== undefined)
      .map((e) => e.rates_after[p.name]);
    const spark = sparkline(series, 40);
    const pct = (p.success_rate * 100).toFixed(0).padStart(3) + "%";
    const counts = `[${p.ok}/${p.total}]`.padEnd(8);
    const lat = p.total > 0 ? `${p.avg_latency_ms}ms` : "—";
    lines.push(
      `  ${p.name.padEnd(10)} ${spark}  ${pct}  ${counts}  avg ${lat}`,
    );
  }

  lines.push(``);

  const recent = events.slice(-6).reverse();
  if (recent.length > 0) {
    lines.push(`Recent calls:`);
    for (const e of recent) {
      const flag = e.success ? "ok  " : "FAIL";
      lines.push(
        `  #${String(e.call_index).padEnd(3)} ${e.provider.padEnd(10)} ${flag}`,
      );
    }
  }

  return lines.join("\n");
}
