// Composio execution layer — commits the cited.md credit report to GitHub and
// fires downgrade alerts, both THROUGH Composio (CLAUDE.md sponsor requirement).
//
// The GitHub connection is OAuth, owned by a Composio "user"; tool calls are
// version-pinned. We resolve the toolkit version dynamically (no hardcoded
// snapshot that rots) and cache the client. Throw-safe: composioEnabled() is
// false when unconfigured, and every call returns a {ok,...} result instead of
// throwing, so the bureau keeps running even if a commit/alert fails.

import { Composio } from "@composio/core";

const OWNER = process.env.COMPOSIO_GITHUB_OWNER || "getinvariant";
const REPO = process.env.COMPOSIO_GITHUB_REPO || "mcp";
const BRANCH = process.env.COMPOSIO_GITHUB_BRANCH || "feat/payments";
// The Composio user that owns the connected GitHub account.
const USER_ID =
  process.env.COMPOSIO_USER_ID || "pg-test-baa30449-f066-44ef-ba85-564bd6f62685";

let _client: Composio | null = null;
let _githubVersion: string | null = null;

export function composioEnabled(): boolean {
  return !!process.env.COMPOSIO_API_KEY;
}

async function githubVersion(base: Composio): Promise<string> {
  if (_githubVersion) return _githubVersion;
  if (process.env.COMPOSIO_GITHUB_VERSION) {
    return (_githubVersion = process.env.COMPOSIO_GITHUB_VERSION);
  }
  // Ask Composio which version of the commit tool is current.
  const tools: any = await base.tools.getRawComposioTools({
    tools: ["GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS"],
  } as any);
  const list = tools?.items ?? tools ?? [];
  const t =
    list.find((x: any) => x.slug === "GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS") ||
    list[0];
  return (_githubVersion = t?.version || "20260501_01");
}

async function client(): Promise<Composio> {
  if (_client) return _client;
  // First make a bare client to learn the version, then pin it.
  const bare = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  const version = await githubVersion(bare);
  _client = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY,
    toolkitVersions: { github: version } as any,
  });
  return _client;
}

export interface CommitResult {
  ok: boolean;
  url?: string;
  sha?: string;
  error?: string;
}

/**
 * Commit (create or update) a file in the configured repo via Composio's
 * GitHub tool. Reads the existing file's blob sha first so updates don't 409.
 */
export async function commitFile(
  path: string,
  content: string,
  message: string,
): Promise<CommitResult> {
  if (!composioEnabled()) return { ok: false, error: "COMPOSIO_API_KEY unset" };
  try {
    const c = await client();

    // GitHub's contents API needs the current blob sha to update an existing
    // file. Fetch it; ignore "not found" (first write).
    let sha: string | undefined;
    try {
      const get: any = await c.tools.execute("GITHUB_GET_REPOSITORY_CONTENT", {
        userId: USER_ID,
        arguments: { owner: OWNER, repo: REPO, path, ref: BRANCH },
      } as any);
      sha =
        get?.data?.sha ??
        get?.data?.response_data?.sha ??
        get?.data?.content?.sha;
    } catch {
      /* file doesn't exist yet — create path */
    }

    const args: Record<string, unknown> = {
      owner: OWNER,
      repo: REPO,
      path,
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: BRANCH,
    };
    if (sha) args.sha = sha;

    const out: any = await c.tools.execute(
      "GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS",
      { userId: USER_ID, arguments: args } as any,
    );
    if (!out?.successful) {
      const err =
        out?.error ??
        out?.data?.http_error ??
        JSON.stringify(out?.data ?? {}).slice(0, 200);
      return { ok: false, error: String(err) };
    }
    return {
      ok: true,
      url:
        out?.data?.commit?.html_url ??
        out?.data?.content?.html_url ??
        out?.data?.response_data?.commit?.html_url,
      sha: out?.data?.commit?.sha ?? out?.data?.content?.sha,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Fire a downgrade alert through Composio. Prefers Slack if a channel is
 * configured; otherwise opens a GitHub issue on the repo (also "through
 * Composio"). Always also logs to console so the alert is visible in the demo.
 */
export async function postAlert(
  title: string,
  body: string,
): Promise<{ ok: boolean; via: string; url?: string; error?: string }> {
  console.error(`\n🚨 DOWNGRADE ALERT — ${title}\n${body}\n`);
  if (!composioEnabled()) return { ok: false, via: "console", error: "COMPOSIO_API_KEY unset" };
  try {
    const c = await client();
    const channel = process.env.COMPOSIO_SLACK_CHANNEL;
    if (channel) {
      const out: any = await c.tools.execute("SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL", {
        userId: USER_ID,
        arguments: { channel, text: `*${title}*\n${body}` },
      } as any);
      if (out?.successful) return { ok: true, via: "slack" };
    }
    // Fallback: a GitHub issue is a durable, real Composio side effect.
    const issue: any = await c.tools.execute("GITHUB_CREATE_AN_ISSUE", {
      userId: USER_ID,
      arguments: { owner: OWNER, repo: REPO, title: `Bureau downgrade: ${title}`, body },
    } as any);
    if (issue?.successful) {
      return { ok: true, via: "github-issue", url: issue?.data?.html_url ?? issue?.data?.response_data?.html_url };
    }
    return { ok: false, via: "console", error: "slack+github both failed" };
  } catch (e) {
    return { ok: false, via: "console", error: (e as Error).message };
  }
}
