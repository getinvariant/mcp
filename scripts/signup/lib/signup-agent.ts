// Stagehand-driven signup agent. Runs a local Chromium, fills the signup
// form with provided identity, handles email verification mid-flow, then
// extracts the API key from the dashboard.

import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import type { Recipe, SignupResult } from "./types.ts";
import { allocateAlias, dotFallbackAlias, waitForVerificationLink } from "./email.ts";
import { generatePassword } from "./password.ts";
import { storeCreds } from "./creds.ts";

const STAGEHAND_TIMEOUT_MS = 180_000;

function identity() {
  return {
    firstName: process.env.SIGNUP_FIRST_NAME || "Tobi",
    lastName: process.env.SIGNUP_LAST_NAME || "Birajma",
    company: process.env.SIGNUP_COMPANY || "ProcurementLabs",
    country: process.env.SIGNUP_COUNTRY || "United States",
  };
}

function buildSignupPrompt(recipe: Recipe, email: string, password: string): string {
  const id = identity();
  const lines = [
    `You are signing up for the API service "${recipe.display_name}" (${recipe.name}).`,
    `Use these credentials when filling forms:`,
    `  - email: ${email}`,
    `  - password: ${password}`,
    `  - first name: ${id.firstName}`,
    `  - last name: ${id.lastName}`,
    `  - full name: ${id.firstName} ${id.lastName}`,
    `  - company / organization: ${id.company}`,
    `  - country: ${id.country}`,
    ``,
    `Instructions:`,
    `1. Locate the signup / register / "create account" form on the page.`,
    `2. Fill every required field with the credentials above. If a field asks for a phone number, leave it blank or skip and try to submit — if phone is required, abort and report failure.`,
    `3. Accept any "I agree to terms" or marketing-opt-in checkboxes that are required.`,
    `4. Submit the form.`,
    `5. If the next screen asks for additional info (use case, role, team size), pick reasonable defaults that allow you to continue.`,
    `6. Do NOT navigate away from the domain unless the flow requires it.`,
    `7. If a CAPTCHA appears, wait up to 30 seconds for it to auto-solve. If it doesn't, report failure.`,
    `8. Stop when one of:`,
    `   (a) you see a "check your email" / "verify your email" message — say exactly: AWAIT_EMAIL_VERIFICATION`,
    `   (b) you reach the dashboard / settings / api-keys page — say exactly: SIGNUP_COMPLETE`,
    `   (c) signup fails permanently — say exactly: SIGNUP_FAILED with one-line reason`,
  ];
  if (recipe.extra_hint) {
    lines.push("", `Additional provider-specific guidance: ${recipe.extra_hint}`);
  }
  return lines.join("\n");
}

function buildExtractPrompt(recipe: Recipe): string {
  return [
    `You are on the dashboard for ${recipe.display_name} (${recipe.name}).`,
    `Goal: find the API key (sometimes called token, secret key, access token, or app id) on this page or one click away.`,
    `If there is a "reveal", "show", or "copy" button next to a key, click it to reveal the actual value.`,
    `If keys must be generated and none exist yet, click the "create new key" / "generate" button and accept defaults.`,
    `Return the literal key value as a string. Do not return a placeholder like "••••" or "***".`,
  ].join("\n");
}

const KeySchema = z.object({
  api_key: z.string().min(8).describe("The literal API key value, with no masking"),
});

export async function runSignup(recipe: Recipe): Promise<SignupResult> {
  if (recipe.oauth_only) {
    return {
      recipe,
      ok: false,
      error: "oauth_only — skipped",
      duration_ms: 0,
    };
  }

  const started = Date.now();
  const password = generatePassword(20);
  let email = allocateAlias(recipe.name);

  // Persistent profile lives next to the orchestrator. Cookies, localStorage,
  // and any installed extensions persist across runs in this dir.
  const profileDir = new URL("../chrome-profile/", import.meta.url).pathname;

  // NopeCHA unpacked extension shipped via `npm run install-nopecha`.
  // Loaded via Chromium's --load-extension flag (Web Store install is blocked
  // in Chrome-for-Testing, so we side-load).
  const nopechaDir = new URL("../extensions/nopecha/", import.meta.url).pathname;
  const extensionArgs = [
    `--disable-extensions-except=${nopechaDir}`,
    `--load-extension=${nopechaDir}`,
  ];

  const stagehand = new Stagehand({
    env: "LOCAL",
    // Date-suffixed model required for Stagehand's Computer Use agent path.
    modelName: "claude-haiku-4-5-20251001",
    modelClientOptions: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
    verbose: 0,
    localBrowserLaunchOptions: {
      headless: false,
      userDataDir: profileDir,
      preserveUserDataDir: true,
      args: extensionArgs,
    },
  });

  try {
    await stagehand.init();
    const page = stagehand.page;

    // ---- Attempt 1: + alias ------------------------------------------------
    let result = await attemptSignup(stagehand, recipe, email, password);

    // Some sites reject + in emails. Retry once with the dot fallback alias.
    if (result === "EMAIL_REJECTED") {
      email = dotFallbackAlias(recipe.name);
      // Fresh page, re-navigate.
      await page.goto(recipe.signup_url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      result = await attemptSignup(stagehand, recipe, email, password);
    }

    if (result === "FAILED") {
      throw new Error("Agent reported SIGNUP_FAILED");
    }

    // ---- Email verification handoff ---------------------------------------
    if (result === "AWAIT_EMAIL") {
      const link = await waitForVerificationLink(email, { timeoutMs: 180_000 });
      await page.goto(link, { waitUntil: "domcontentloaded", timeout: 30_000 });
      // Some flows auto-redirect to dashboard; others need explicit nav.
      await new Promise((r) => setTimeout(r, 3_000));
    }

    // ---- Navigate to dashboard + extract key ------------------------------
    await page.goto(recipe.dashboard_url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Give the agent a chance to click through "create key" buttons if needed.
    await stagehand.agent({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      instructions: buildExtractPrompt(recipe),
    }).execute({ instruction: "Reveal and copy the API key on this page.", maxSteps: 10 });

    const extracted = await stagehand.page.extract({
      instruction: buildExtractPrompt(recipe),
      schema: KeySchema,
    });

    const api_key = extracted?.api_key?.trim();
    if (!api_key || /^[•*]+$/.test(api_key)) {
      throw new Error("Extracted key was masked or empty");
    }

    await storeCreds({
      provider: recipe.name,
      email,
      password,
      api_key,
      signup_url: recipe.signup_url,
      dashboard_url: recipe.dashboard_url,
      created_at: new Date().toISOString(),
    });

    return {
      recipe,
      ok: true,
      api_key,
      email,
      password,
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    return {
      recipe,
      ok: false,
      email,
      password,
      error: (err as Error).message,
      duration_ms: Date.now() - started,
    };
  } finally {
    await stagehand.close().catch(() => {});
  }
}

type AttemptOutcome = "AWAIT_EMAIL" | "COMPLETE" | "FAILED" | "EMAIL_REJECTED";

async function attemptSignup(
  stagehand: Stagehand,
  recipe: Recipe,
  email: string,
  password: string,
): Promise<AttemptOutcome> {
  await stagehand.page.goto(recipe.signup_url, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  const agent = stagehand.agent({
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    instructions: buildSignupPrompt(recipe, email, password),
  });

  const result = await Promise.race([
    agent.execute({ instruction: "Complete the signup flow as instructed.", maxSteps: 30 }),
    new Promise<{ message: string }>((_, reject) =>
      setTimeout(() => reject(new Error("agent timeout")), STAGEHAND_TIMEOUT_MS),
    ),
  ]);

  const text = (result as any)?.message?.toString().toUpperCase() || "";
  if (text.includes("AWAIT_EMAIL_VERIFICATION")) return "AWAIT_EMAIL";
  if (text.includes("SIGNUP_COMPLETE")) return "COMPLETE";
  if (text.includes("INVALID EMAIL") || text.includes("EMAIL FORMAT") || text.includes("PLUS SIGN")) {
    return "EMAIL_REJECTED";
  }
  if (text.includes("SIGNUP_FAILED")) return "FAILED";
  // Treat "didn't say anything definitive" as proceed-and-see — most pages
  // land on a dashboard after submit without printing the magic word.
  if (recipe.needs_email_verify) return "AWAIT_EMAIL";
  return "COMPLETE";
}
