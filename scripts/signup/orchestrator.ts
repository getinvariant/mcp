// Main entry. Four subcommands:
//
//   enumerate   — pull catalogs from 6 aggregators, emit data/aggregator.json
//   signup      — run Stagehand on the 70 standalone recipes, emit data/standalone.json
//   smoke       — re-test every config in data/, mark live/dead
//   merge       — combine aggregator + standalone into data/generated-providers.json
//                 that the main app loads at boot

import "dotenv/config";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import PQueue from "p-queue";

import { enumerateOpenRouter } from "./enumerators/openrouter.ts";
import { enumerateHuggingFace } from "./enumerators/huggingface.ts";
import { enumerateReplicate } from "./enumerators/replicate.ts";
import { enumerateFal } from "./enumerators/fal.ts";
import { enumerateTogether } from "./enumerators/together.ts";
import { enumerateAPILayer } from "./enumerators/apilayer.ts";
import { STANDALONE_RECIPES } from "./recipes/standalone.ts";
import { AGGREGATOR_RECIPES } from "./recipes/aggregators.ts";
import { runSignup } from "./lib/signup-agent.ts";
import { smokeTest } from "./lib/smoke.ts";
import { loadCreds } from "./lib/creds.ts";
import type { ProviderConfig, Recipe, SignupResult } from "./lib/types.ts";

/**
 * Resolve an aggregator's API key. Prefer the key written by the signup
 * agent into creds/{name}.json, fall back to env var (so users who signed up
 * manually can still enumerate).
 */
async function resolveAggregatorKey(
  providerName: string,
  envVar: string,
): Promise<string | undefined> {
  const cred = await loadCreds(providerName);
  if (cred?.api_key) return cred.api_key;
  return process.env[envVar];
}

const DATA_DIR = process.env.OUTPUT_DIR || new URL("./data/", import.meta.url).pathname;
const AGGREGATOR_FILE = `${DATA_DIR}/aggregator.json`;
const STANDALONE_FILE = `${DATA_DIR}/standalone.json`;
const MERGED_FILE = `${DATA_DIR}/generated-providers.json`;
const SIGNUP_LOG = `${DATA_DIR}/signup-log.json`;

async function ensureData(): Promise<void> {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
}

// ────────────────────────────────────────────────────────────────────────────
// enumerate

async function cmdEnumerate(): Promise<void> {
  await ensureData();
  // For each aggregator: try creds/{name}.json first, then env var.
  const keys = {
    openrouter: await resolveAggregatorKey("openrouter", "OPENROUTER_API_KEY"),
    huggingface: await resolveAggregatorKey("huggingface", "HUGGINGFACE_API_KEY"),
    replicate: await resolveAggregatorKey("replicate", "REPLICATE_API_TOKEN"),
    fal: await resolveAggregatorKey("fal", "FAL_KEY"),
    together: await resolveAggregatorKey("together", "TOGETHER_API_KEY"),
    apilayer: await resolveAggregatorKey("apilayer", "APILAYER_API_KEY"),
  };

  const sources: Array<{ name: string; fn: () => Promise<ProviderConfig[]> }> = [
    { name: "openrouter", fn: () => enumerateOpenRouter(keys.openrouter!) },
    { name: "huggingface", fn: () => enumerateHuggingFace(keys.huggingface!) },
    { name: "replicate", fn: () => enumerateReplicate(keys.replicate!) },
    { name: "fal", fn: () => enumerateFal(keys.fal!) },
    { name: "together", fn: () => enumerateTogether(keys.together!) },
    { name: "apilayer", fn: () => enumerateAPILayer(keys.apilayer!) },
  ];

  const all: ProviderConfig[] = [];
  for (const src of sources) {
    try {
      console.log(`[enumerate] ${src.name} …`);
      const rows = await src.fn();
      console.log(`[enumerate] ${src.name} → ${rows.length} providers`);
      all.push(...rows);
    } catch (err) {
      console.warn(`[enumerate] ${src.name} FAILED: ${(err as Error).message}`);
    }
  }

  await writeFile(AGGREGATOR_FILE, JSON.stringify(all, null, 2));
  console.log(`[enumerate] wrote ${all.length} aggregator-sourced providers → ${AGGREGATOR_FILE}`);
}

// ────────────────────────────────────────────────────────────────────────────
// signup

async function runRecipeBatch(
  recipes: Recipe[],
  label: string,
): Promise<SignupResult[]> {
  // Aggregator signups must serialize (they all use the same Gmail inbox
  // namespace for verification, and we keep concurrency=1 to avoid IMAP
  // racing). Standalones run in parallel.
  const concurrency =
    label === "aggregators" ? 1 : Number(process.env.SIGNUP_CONCURRENCY || 4);
  console.log(`[signup:${label}] ${recipes.length} recipes, concurrency=${concurrency}`);
  const queue = new PQueue({ concurrency });
  const results: SignupResult[] = [];

  for (const recipe of recipes) {
    queue.add(async () => {
      console.log(`[signup:${label}] → ${recipe.name}`);
      const result = await runSignup(recipe);
      results.push(result);
      console.log(
        `[signup:${label}] ${result.ok ? "OK" : "FAIL"} ${recipe.name} ` +
          `(${(result.duration_ms / 1000).toFixed(1)}s)` +
          (result.error ? ` — ${result.error}` : ""),
      );
    });
  }
  await queue.onIdle();
  return results;
}

async function cmdSignup(only?: string): Promise<void> {
  await ensureData();
  let recipes: Recipe[] = STANDALONE_RECIPES;
  if (only) recipes = recipes.filter((r) => r.name === only || r.category === only);
  if (recipes.length === 0) {
    console.log(`No standalone recipes match filter: ${only}`);
    return;
  }
  const results = await runRecipeBatch(recipes, "standalone");

  const configs: ProviderConfig[] = [];
  const now = new Date().toISOString();
  for (const r of results) {
    if (!r.ok || !r.api_key) continue;
    configs.push({
      id: r.recipe.name,
      name: r.recipe.display_name,
      category: r.recipe.category,
      description: `${r.recipe.display_name} (auto-provisioned via signup orchestrator).`,
      api_key: r.api_key,
      source: "standalone",
      sample_endpoint: r.recipe.smoke_test,
      generated_at: now,
    });
  }

  await writeFile(STANDALONE_FILE, JSON.stringify(configs, null, 2));
  await writeFile(SIGNUP_LOG, JSON.stringify(results, null, 2));

  const ok = results.filter((r) => r.ok).length;
  console.log(`[signup] done — ${ok}/${results.length} live → ${STANDALONE_FILE}`);
}

async function cmdSignupAggregators(only?: string): Promise<void> {
  await ensureData();
  let recipes = AGGREGATOR_RECIPES;
  if (only) recipes = recipes.filter((r) => r.name === only);
  if (recipes.length === 0) {
    console.log(`No aggregator recipes match filter: ${only}`);
    return;
  }
  const results = await runRecipeBatch(recipes, "aggregators");
  await writeFile(
    `${DATA_DIR}/aggregator-signup-log.json`,
    JSON.stringify(results, null, 2),
  );

  const ok = results.filter((r) => r.ok).length;
  console.log(
    `[signup:aggregators] done — ${ok}/${results.length} live. ` +
      `Run 'npm run enumerate' next to expand into provider configs.`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// smoke

async function cmdSmoke(): Promise<void> {
  await ensureData();
  const merged = JSON.parse(await readFile(MERGED_FILE, "utf8")) as ProviderConfig[];

  const queue = new PQueue({ concurrency: 20 });
  let ok = 0;
  let fail = 0;

  for (const cfg of merged) {
    queue.add(async () => {
      const result = await smokeTest(cfg);
      cfg.smoke_ok = result.ok;
      cfg.smoke_error = result.error;
      if (result.ok) ok++;
      else fail++;
    });
  }
  await queue.onIdle();

  await writeFile(MERGED_FILE, JSON.stringify(merged, null, 2));
  console.log(`[smoke] ${ok} live / ${fail} dead out of ${merged.length}`);
}

// ────────────────────────────────────────────────────────────────────────────
// merge

async function cmdMerge(): Promise<void> {
  await ensureData();
  const aggregator: ProviderConfig[] = existsSync(AGGREGATOR_FILE)
    ? JSON.parse(await readFile(AGGREGATOR_FILE, "utf8"))
    : [];
  const standalone: ProviderConfig[] = existsSync(STANDALONE_FILE)
    ? JSON.parse(await readFile(STANDALONE_FILE, "utf8"))
    : [];

  // De-dupe by id, prefer standalone (more specific).
  const map = new Map<string, ProviderConfig>();
  for (const c of aggregator) map.set(c.id, c);
  for (const c of standalone) map.set(c.id, c);

  const merged = Array.from(map.values());
  await writeFile(MERGED_FILE, JSON.stringify(merged, null, 2));
  console.log(`[merge] ${aggregator.length} aggregator + ${standalone.length} standalone = ${merged.length} unique → ${MERGED_FILE}`);
}

// ────────────────────────────────────────────────────────────────────────────
// dispatch

const cmd = process.argv[2];
const arg = process.argv[3];

switch (cmd) {
  case "enumerate":
    await cmdEnumerate();
    break;
  case "signup":
    await cmdSignup(arg);
    break;
  case "signup-aggregators":
    await cmdSignupAggregators(arg);
    break;
  case "all": {
    // Convenience: full pipeline in one shot.
    await cmdSignupAggregators();
    await cmdEnumerate();
    await cmdSignup(arg);
    await cmdMerge();
    await cmdSmoke();
    break;
  }
  case "smoke":
    await cmdSmoke();
    break;
  case "merge":
    await cmdMerge();
    break;
  default:
    console.log(
      `Usage: tsx orchestrator.ts <signup-aggregators|enumerate|signup [name|category]|merge|smoke|all>`,
    );
    process.exit(1);
}
