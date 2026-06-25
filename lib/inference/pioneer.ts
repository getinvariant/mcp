// Pioneer inference client — the LLM that powers the bureau's reasoning and,
// crucially, the accuracy judgment that feeds the creditworthiness score.
//
// Pioneer exposes an OpenAI-compatible /chat/completions endpoint and returns
// an x_pioneer.inference_id we keep as proof the accuracy input was served on
// the platform. Throw-safe: pioneerEnabled() is false when unconfigured and
// callers fall back to a heuristic.

export function pioneerEnabled(): boolean {
  return !!(process.env.PIONEER_API_KEY && process.env.PIONEER_BASE_URL);
}

export interface PioneerReply {
  text: string;
  inferenceId: string | null;
  model: string;
}

/** One OpenAI-style chat completion against the Pioneer-served model. */
export async function pioneerChat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<PioneerReply> {
  const base = (process.env.PIONEER_BASE_URL || "").replace(/\/$/, "");
  const key = process.env.PIONEER_API_KEY;
  const model = process.env.PIONEER_MODEL || "Qwen/Qwen3-8B";
  if (!base || !key) throw new Error("pioneer not configured");

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: opts.maxTokens ?? 256,
      temperature: opts.temperature ?? 0,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`pioneer HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json: any = await res.json();
  return {
    text: json?.choices?.[0]?.message?.content ?? "",
    inferenceId: json?.x_pioneer?.inference_id ?? null,
    model: json?.model ?? model,
  };
}
