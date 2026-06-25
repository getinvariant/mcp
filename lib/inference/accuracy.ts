// Accuracy judging — the non-trivial input to the creditworthiness score.
//
// success-rate and cost are mechanical (did the call 200? what did it cost?).
// "Did the provider actually DELIVER value?" is a judgment call, and CLAUDE.md
// requires that judgment come from the inference platform (Pioneer). We hand
// the model the request + the provider's response and ask for a 0..1 grade.
//
// Returns { accuracy, inferenceId, judged }. judged=false means Pioneer was
// unavailable/unparseable and we fell back to a conservative heuristic, so the
// caller can tell a real grade from a fallback.

import { pioneerChat, pioneerEnabled } from "./pioneer.js";

export interface AccuracyInput {
  category: string;
  provider: string;
  action: string;
  params: Record<string, unknown>;
  result: unknown;
}

export interface AccuracyVerdict {
  accuracy: number; // 0..1
  inferenceId: string | null;
  judged: boolean;
}

// When Pioneer can't grade, a successful call that returned data is assumed
// decent but not perfect — never 1.0, so a real graded win still beats a
// fallback. Failures are scored 0 upstream and never reach the judge.
const FALLBACK_ACCURACY = 0.8;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export async function judgeAccuracy(
  input: AccuracyInput,
): Promise<AccuracyVerdict> {
  if (!pioneerEnabled()) {
    return { accuracy: FALLBACK_ACCURACY, inferenceId: null, judged: false };
  }

  // Trim the result so we don't blow the context on huge payloads.
  let resultStr = "";
  try {
    resultStr = JSON.stringify(input.result);
  } catch {
    resultStr = String(input.result);
  }
  if (resultStr.length > 2000) resultStr = resultStr.slice(0, 2000) + "…(truncated)";

  const system =
    "You are a strict QA grader for a paid-API credit bureau. Given a request " +
    "and the API provider's response, grade how well the response actually " +
    "answers the request on a scale from 0.0 (useless/wrong) to 1.0 (perfect, " +
    "complete, correct). Reward correct, specific, complete data; penalize " +
    "empty results, wrong entities, or missing fields. Reply with ONLY the " +
    "number, e.g. 0.92";

  const user =
    `Category: ${input.category}\n` +
    `Provider: ${input.provider}\n` +
    `Action: ${input.action}\n` +
    `Request params: ${JSON.stringify(input.params)}\n` +
    `Provider response: ${resultStr}\n\n` +
    `Grade (0.0-1.0):`;

  try {
    const reply = await pioneerChat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { maxTokens: 16, temperature: 0 },
    );
    const m = reply.text.match(/\d*\.?\d+/);
    if (!m) {
      return { accuracy: FALLBACK_ACCURACY, inferenceId: reply.inferenceId, judged: false };
    }
    return {
      accuracy: clamp01(parseFloat(m[0])),
      inferenceId: reply.inferenceId,
      judged: true,
    };
  } catch (e) {
    console.error("[accuracy] pioneer judge failed:", (e as Error).message);
    return { accuracy: FALLBACK_ACCURACY, inferenceId: null, judged: false };
  }
}
