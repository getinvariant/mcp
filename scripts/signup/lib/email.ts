// Gmail alias generation + IMAP polling for verification links.

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

type Inbox = {
  address: string;
  appPassword: string;
};

function loadInboxes(): Inbox[] {
  const primary = process.env.GMAIL_PRIMARY;
  const primaryPw = process.env.GMAIL_APP_PASSWORD_PRIMARY;
  const secondary = process.env.GMAIL_SECONDARY;
  const secondaryPw = process.env.GMAIL_APP_PASSWORD_SECONDARY;
  const out: Inbox[] = [];
  if (primary && primaryPw) out.push({ address: primary, appPassword: primaryPw });
  if (secondary && secondaryPw) out.push({ address: secondary, appPassword: secondaryPw });
  if (out.length === 0) {
    throw new Error("No Gmail inboxes configured. Set GMAIL_PRIMARY + GMAIL_APP_PASSWORD_PRIMARY.");
  }
  return out;
}

/**
 * Allocate an alias for a given provider. Round-robins across the two inboxes
 * so each gets ~half the signups, and uses +tag so verification email matching
 * is deterministic. Caller falls back to dot-trick if the site rejects the +.
 */
export function allocateAlias(providerName: string, attempt = 0): string {
  const inboxes = loadInboxes();
  // Hash provider name into one of the inboxes for deterministic + sticky-on-retry behavior.
  const hash = providerName.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const inbox = inboxes[(hash + attempt) % inboxes.length];
  const [local, domain] = inbox.address.split("@");
  return `${local}+${providerName}@${domain}`;
}

/** Dot-variant fallback when a site rejects `+` in emails. */
export function dotFallbackAlias(providerName: string): string {
  const inboxes = loadInboxes();
  const hash = providerName.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const inbox = inboxes[hash % inboxes.length];
  const [local, domain] = inbox.address.split("@");
  // Insert one dot at a hash-determined position (skips position 0).
  const pos = 1 + (hash % (local.length - 1));
  const dotted = local.slice(0, pos) + "." + local.slice(pos);
  return `${dotted}@${domain}`;
}

/** Canonicalize a Gmail address (strip dots + +tag). Used to find the underlying inbox. */
function canonicalize(addr: string): string {
  const [local, domain] = addr.toLowerCase().split("@");
  const noTag = local.split("+")[0];
  const noDots = noTag.replace(/\./g, "");
  return `${noDots}@${domain}`;
}

function findInboxForAlias(alias: string): Inbox {
  const canon = canonicalize(alias);
  for (const inbox of loadInboxes()) {
    if (canonicalize(inbox.address) === canon) return inbox;
  }
  throw new Error(`No inbox matches alias ${alias} (canonical=${canon})`);
}

const VERIFY_LINK_RE =
  /https?:\/\/[^\s"'<>]*?(?:verify|confirm|activate|validation|validate|email_verification|verification|complete-signup|action|magic)[^\s"'<>]*/gi;

/**
 * Poll the relevant inbox for an email sent TO `alias` (or referencing it),
 * with a verification-style link in the body. Returns the first matching URL.
 *
 * Stops polling after timeoutMs. Throws on timeout.
 */
export async function waitForVerificationLink(
  alias: string,
  opts: { timeoutMs?: number; pollIntervalMs?: number; senderHint?: string } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 5_000;
  const inbox = findInboxForAlias(alias);

  const start = Date.now();
  // The mailbox we care about. Gmail aliases land in the same INBOX as the canonical address.
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: inbox.address, pass: inbox.appPassword },
    logger: false,
  });
  await client.connect();

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      while (Date.now() - start < timeoutMs) {
        // Search for emails delivered TO the alias in the last hour.
        // Gmail SEARCH supports `to:` query via X-GM-RAW for full-power search.
        const queryParts: string[] = [`to:${alias}`, "newer_than:1h"];
        if (opts.senderHint) queryParts.push(`from:${opts.senderHint}`);
        const gmRaw = queryParts.join(" ");
        const uids = await client.search({ gmraw: gmRaw } as any, { uid: true });

        if (uids && uids.length > 0) {
          // Take the most recent — last UID is usually latest in Gmail.
          const uid = uids[uids.length - 1];
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (msg && msg.source) {
            const parsed = await simpleParser(msg.source);
            const body = `${parsed.text || ""}\n${parsed.html || ""}`;
            const matches = body.match(VERIFY_LINK_RE);
            if (matches && matches.length > 0) {
              return matches[0].replace(/&amp;/g, "&");
            }
            // No matching link yet — give it another poll, body might still be templated weirdly.
          }
        }

        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
      throw new Error(`Verification link for ${alias} not received within ${timeoutMs}ms`);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
