export interface ProviderIntelligence {
  id: string;
  pricing: PricingInfo;
  rateLimits: RateLimitInfo;
  strengths: string[];
  weaknesses: string[];
  bestFor: string[];
  dataFreshness: "real-time" | "near-real-time" | "daily" | "static";
  reliability: "high" | "medium" | "low";
  alternatives: string[]; // other provider IDs that cover similar functionality
}

export interface PricingInfo {
  model: "free" | "freemium" | "paid";
  freeTier: string | null; // e.g. "240 req/hour"
  paidStartsAt: string | null; // e.g. "$49/mo"
  notes: string | null;
}

export interface RateLimitInfo {
  free: string | null; // e.g. "60 calls/min"
  paid: string | null;
}

export interface Recommendation {
  provider_id: string;
  provider_name: string;
  score: number; // 0-100
  reasoning: string;
  actions: string[]; // relevant actions for the use case
  pricing: PricingInfo;
  rateLimits: RateLimitInfo;
  available: boolean; // whether the API key is configured on the server
}

export interface RecommendationRequest {
  need: string; // natural language description of what user needs
  priorities?: Priority[]; // what matters most
  budget?: "free" | "low" | "any";
}

export type Priority =
  | "cost"
  | "reliability"
  | "speed"
  | "data-quality"
  | "no-auth";
