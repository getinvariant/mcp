import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, "../../data/store.json");

export interface UsageEntry {
  providerId: string;
  action: string;
  creditsUsed: number;
  timestamp: string;
}

export interface UserRecord {
  name: string;
  apiKey: string;
  balance: number;
  totalUsed: number;
  provisionedProviders: string[];
  usage: UsageEntry[];
  createdAt: string;
  rateLimit: {
    windowStart: number;
    requestCount: number;
  };
}

interface Store {
  users: Record<string, UserRecord>;
}

function readStore(): Store {
  if (!fs.existsSync(STORE_PATH)) {
    const initial: Store = { users: {} };
    writeStore(initial);
    return initial;
  }
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
}

function writeStore(store: Store): void {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function getUser(apiKey: string): UserRecord | null {
  const store = readStore();
  return store.users[apiKey] ?? null;
}

export function createUser(name: string, apiKey: string): UserRecord {
  const store = readStore();
  const user: UserRecord = {
    name,
    apiKey,
    balance: config.defaultBalance,
    totalUsed: 0,
    provisionedProviders: [],
    usage: [],
    createdAt: new Date().toISOString(),
    rateLimit: { windowStart: Date.now(), requestCount: 0 },
  };
  store.users[apiKey] = user;
  writeStore(store);
  return user;
}

export function deductBalance(apiKey: string, amount: number): boolean {
  const store = readStore();
  const user = store.users[apiKey];
  if (!user || user.balance < amount) return false;
  user.balance -= amount;
  user.totalUsed += amount;
  writeStore(store);
  return true;
}

export function addProvision(apiKey: string, providerId: string): boolean {
  const store = readStore();
  const user = store.users[apiKey];
  if (!user) return false;
  if (!user.provisionedProviders.includes(providerId)) {
    user.provisionedProviders.push(providerId);
    writeStore(store);
  }
  return true;
}

export function recordUsage(
  apiKey: string,
  providerId: string,
  action: string,
  creditsUsed: number
): void {
  const store = readStore();
  const user = store.users[apiKey];
  if (!user) return;
  user.usage.push({
    providerId,
    action,
    creditsUsed,
    timestamp: new Date().toISOString(),
  });
  writeStore(store);
}

export function seedDemoUser(): void {
  const existing = getUser(config.demoKey);
  if (!existing) {
    createUser("Demo User", config.demoKey);
  }
}
