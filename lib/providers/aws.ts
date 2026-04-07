import { Provider, ProviderCategory, ProviderInfo, QueryResult } from "./types.js";

// AWS Signature V4 signing (no SDK dependency)
async function signedFetch(
  url: string,
  method: string,
  body: string,
  service: string,
  region: string,
  accessKey: string,
  secretKey: string
): Promise<Response> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);

  const parsedUrl = new URL(url);
  const host = parsedUrl.host;
  const canonicalUri = parsedUrl.pathname;
  const canonicalQueryString = parsedUrl.searchParams.toString();
  const payloadHash = await sha256Hex(body);

  const canonicalHeaders = `content-type:application/x-amz-json-1.1\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";

  const canonicalRequest = [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");

  const signingKey = await getSigningKey(secretKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, {
    method,
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Date": amzDate,
      Authorization: authHeader,
    },
    body,
  });
}

async function sha256Hex(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: ArrayBuffer | string, message: string): Promise<ArrayBuffer> {
  const keyMaterial = typeof key === "string"
    ? await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    : await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", keyMaterial, new TextEncoder().encode(message));
}

async function hmacHex(key: ArrayBuffer, message: string): Promise<string> {
  const sig = await hmac(key, message);
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getSigningKey(secret: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmac(`AWS4${secret}`, date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export class AWSProvider implements Provider {
  info: ProviderInfo = {
    id: "aws",
    name: "AWS Comprehend",
    category: ProviderCategory.CLOUD,
    description: "Amazon Comprehend NLP service — detect sentiment, entities, key phrases, and language in text.",
    availableActions: [
      {
        action: "detect_sentiment",
        description: "Detect the sentiment (Positive, Negative, Neutral, Mixed) of a text",
        parameters: {
          text: { type: "string", description: "Text to analyze (max 5000 bytes)", required: true },
          language: { type: "string", description: "Language code (default: en)", required: false },
        },
      },
      {
        action: "detect_entities",
        description: "Detect named entities (people, places, organizations, etc.) in text",
        parameters: {
          text: { type: "string", description: "Text to analyze", required: true },
          language: { type: "string", description: "Language code (default: en)", required: false },
        },
      },
      {
        action: "detect_key_phrases",
        description: "Extract key phrases from text",
        parameters: {
          text: { type: "string", description: "Text to analyze", required: true },
          language: { type: "string", description: "Language code (default: en)", required: false },
        },
      },
    ],
    requiresApiKey: true,
  };

  isAvailable(): boolean {
    return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  }

  async query(action: string, params: Record<string, unknown>): Promise<QueryResult> {
    const accessKey = process.env.AWS_ACCESS_KEY_ID;
    const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || "us-east-1";

    if (!accessKey || !secretKey) return { success: false, error: "AWS credentials not configured" };

    const text = params.text as string;
    if (!text) return { success: false, error: "Missing required parameter: text" };
    const language = (params.language as string) || "en";

    const actionMap: Record<string, string> = {
      detect_sentiment: "DetectSentiment",
      detect_entities: "DetectEntities",
      detect_key_phrases: "DetectKeyPhrases",
    };

    const target = actionMap[action];
    if (!target) return { success: false, error: `Unknown action: ${action}` };

    const url = `https://comprehend.${region}.amazonaws.com/`;
    const body = JSON.stringify({ Text: text, LanguageCode: language });

    try {
      const res = await signedFetch(url, "POST", body, "comprehend", region, accessKey, secretKey);
      if (!res.ok) {
        const errText = await res.text();
        return { success: false, error: `AWS Comprehend error (${res.status}): ${errText}` };
      }
      const data = await res.json();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: `Request failed: ${(err as Error).message}` };
    }
  }
}
