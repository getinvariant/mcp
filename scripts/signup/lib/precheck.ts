// Fail fast before the orchestrator starts a 45-minute job.
// Validates: Anthropic key, both Gmail IMAP connections, output dir writable.

import "dotenv/config";
import { ImapFlow } from "imapflow";
import { mkdir, writeFile, unlink } from "node:fs/promises";

interface CheckResult {
  name: string;
  ok: boolean;
  message: string;
}

async function checkAnthropic(): Promise<CheckResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { name: "Anthropic", ok: false, message: "ANTHROPIC_API_KEY not set" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
    });
    if (res.ok) return { name: "Anthropic", ok: true, message: "key valid" };
    return { name: "Anthropic", ok: false, message: `HTTP ${res.status}` };
  } catch (err) {
    return { name: "Anthropic", ok: false, message: (err as Error).message };
  }
}

async function checkGmail(label: string, address: string, password: string): Promise<CheckResult> {
  if (!address || !password) {
    return { name: `Gmail ${label}`, ok: false, message: "address or app password missing" };
  }
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: address, pass: password },
    logger: false,
  });
  try {
    await client.connect();
    await client.logout();
    return { name: `Gmail ${label}`, ok: true, message: `IMAP login ok (${address})` };
  } catch (err) {
    return {
      name: `Gmail ${label}`,
      ok: false,
      message: `IMAP login failed: ${(err as Error).message}`,
    };
  }
}

async function checkOutputDir(): Promise<CheckResult> {
  const dir = process.env.OUTPUT_DIR || "./data";
  try {
    await mkdir(dir, { recursive: true });
    const probe = `${dir}/.precheck-${Date.now()}`;
    await writeFile(probe, "ok");
    await unlink(probe);
    return { name: "Output dir", ok: true, message: `${dir} writable` };
  } catch (err) {
    return { name: "Output dir", ok: false, message: (err as Error).message };
  }
}

async function main(): Promise<void> {
  // Secondary inbox is optional — skip its check entirely if not configured.
  const checks: Promise<CheckResult>[] = [
    checkAnthropic(),
    checkGmail(
      "primary",
      process.env.GMAIL_PRIMARY || "",
      process.env.GMAIL_APP_PASSWORD_PRIMARY || "",
    ),
  ];
  if (process.env.GMAIL_SECONDARY) {
    checks.push(
      checkGmail(
        "secondary",
        process.env.GMAIL_SECONDARY,
        process.env.GMAIL_APP_PASSWORD_SECONDARY || "",
      ),
    );
  }
  checks.push(checkOutputDir());
  const results = await Promise.all(checks);

  let allOk = true;
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.name.padEnd(20)} ${r.message}`);
    if (!r.ok) allOk = false;
  }

  if (!allOk) {
    console.log("\nFix the failures above before running `npm run all`.");
    process.exit(1);
  }
  console.log("\nAll precheck items passed. Ready to provision.");
}

main();
