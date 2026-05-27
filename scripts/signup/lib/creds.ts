// Per-provider credential persistence. JSON file per provider in creds/ so we
// can recover keys / re-login later. Gitignored.

import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CREDS_DIR = new URL("../creds/", import.meta.url).pathname;

export interface CredRecord {
  provider: string;
  email: string;
  password: string;
  api_key?: string;
  signup_url: string;
  dashboard_url: string;
  created_at: string;
  notes?: string;
}

async function ensureDir(): Promise<void> {
  if (!existsSync(CREDS_DIR)) await mkdir(CREDS_DIR, { recursive: true });
}

export async function storeCreds(rec: CredRecord): Promise<void> {
  await ensureDir();
  const path = join(CREDS_DIR, `${rec.provider}.json`);
  await writeFile(path, JSON.stringify(rec, null, 2), { mode: 0o600 });
}

export async function loadCreds(provider: string): Promise<CredRecord | null> {
  const path = join(CREDS_DIR, `${provider}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

export async function listStoredProviders(): Promise<string[]> {
  await ensureDir();
  const files = await readdir(CREDS_DIR);
  return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
}
