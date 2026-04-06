import crypto from "node:crypto";
import { getUser } from "./store.js";
import type { UserRecord } from "./store.js";

export function validateKey(apiKey: string): UserRecord | null {
  if (!apiKey || !apiKey.startsWith("pl_")) return null;
  return getUser(apiKey);
}

export function generateKey(): string {
  return `pl_${crypto.randomBytes(16).toString("hex")}`;
}
