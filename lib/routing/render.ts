import { getDolphinFrame } from "./dolphin.js";
import type { RouteResponse } from "../../api/route.js";

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
  const lastCallIndex = events[events.length - 1]?.call_index ?? 0;
  lines.push(getDolphinFrame(lastCallIndex));
  lines.push(``);
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

function formatPrice(price: number): string {
  if (price >= 1) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return price.toFixed(6);
}

function summarizeResult(result: any, symbol: string): string {
  // finance:price — { price, currency }
  if (result && typeof result.price === "number") {
    return `${symbol} $${formatPrice(result.price)}`;
  }
  // env:weather, openweather shape — { main: { temp }, weather: [{ description }], name }
  if (result?.main && typeof result.main.temp === "number") {
    const temp = `${result.main.temp.toFixed(1)}°C`;
    const desc = result.weather?.[0]?.description;
    const place = result.name;
    return [place, temp, desc].filter(Boolean).join(" · ");
  }
  // env:weather, openmeteo shape — { current: { temperature_2m } }
  if (result?.current && typeof result.current.temperature_2m === "number") {
    return `${result.current.temperature_2m.toFixed(1)}°C`;
  }
  // places:geocode, nominatim shape — [{ display_name }, ...]
  if (Array.isArray(result) && result[0]?.display_name) {
    return String(result[0].display_name).slice(0, 60);
  }
  // places:geocode, geoapify shape — { features: [{ properties: { formatted } }] }
  if (result?.features?.[0]?.properties?.formatted) {
    return String(result.features[0].properties.formatted).slice(0, 60);
  }
  return "ok";
}

export function renderRoute(out: RouteResponse, symbol: string): string {
  const lines: string[] = [];
  lines.push(getDolphinFrame(out.call_index));
  lines.push(``);

  if (out.success) {
    const summary = summarizeResult(out.result, symbol);
    lines.push(
      `routed → ${out.provider} · ${summary} · ${out.latency_ms}ms`,
    );
  } else {
    const err = out.result?.error ?? "unknown error";
    lines.push(`routed → ${out.provider} · FAILED · ${err}`);
  }

  lines.push(``);

  for (const name of Object.keys(out.rates)) {
    const pct = (out.rates[name] * 100).toFixed(0).padStart(3) + "%";
    lines.push(`  ${name.padEnd(10)} ${pct}`);
  }

  lines.push(``);
  lines.push(`call #${out.call_index}`);

  return lines.join("\n");
}
