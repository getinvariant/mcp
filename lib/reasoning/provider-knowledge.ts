import { ProviderIntelligence } from "./types.js";

/**
 * Enriched knowledge base about each provider.
 * This goes beyond what the provider code exposes — pricing, trade-offs,
 * competitive analysis, and best-fit use cases.
 */
export const providerKnowledge: Record<string, ProviderIntelligence> = {
  openfda: {
    id: "openfda",
    pricing: {
      model: "free",
      freeTier: "240 req/hour (no key), higher with key",
      paidStartsAt: null,
      notes: "Fully free public API from the U.S. FDA",
    },
    rateLimits: { free: "240 req/hour", paid: null },
    strengths: [
      "Official government data source",
      "No API key required",
      "Comprehensive drug, recall, and adverse event data",
      "Highly reliable — backed by U.S. federal infrastructure",
    ],
    weaknesses: [
      "U.S.-only data",
      "No international drug databases",
      "Rate limits can be restrictive for bulk queries",
    ],
    bestFor: [
      "drug safety research",
      "adverse event tracking",
      "recall monitoring",
      "pharmaceutical compliance",
      "health data analysis",
    ],
    dataFreshness: "near-real-time",
    reliability: "high",
    alternatives: [],
  },

  mental_health: {
    id: "mental_health",
    pricing: {
      model: "free",
      freeTier: "Unlimited (static data)",
      paidStartsAt: null,
      notes: "Curated static database — no external API calls",
    },
    rateLimits: { free: "Unlimited", paid: null },
    strengths: [
      "No API key needed",
      "Instant responses (no external calls)",
      "Curated, verified crisis resources",
      "Includes hotlines, text lines, and web resources",
    ],
    weaknesses: [
      "Static data — not updated in real-time",
      "U.S.-focused resources",
      "Limited to crisis/support resources, not clinical data",
    ],
    bestFor: [
      "crisis resource lookup",
      "mental health support apps",
      "suicide prevention tools",
      "wellness applications",
      "resource directories",
    ],
    dataFreshness: "static",
    reliability: "high",
    alternatives: [],
  },

  claude: {
    id: "claude",
    pricing: {
      model: "paid",
      freeTier: null,
      paidStartsAt: "$0.25/MTok input (Haiku), $3/MTok (Sonnet)",
      notes: "Pay-per-token. Haiku is cheapest, Opus is most capable.",
    },
    rateLimits: { free: null, paid: "Varies by tier" },
    strengths: [
      "Best-in-class reasoning and instruction following",
      "Strong safety alignment",
      "Large context window (200k tokens)",
      "Excellent at structured output and code",
    ],
    weaknesses: [
      "Requires API key and payment",
      "Higher latency than smaller models",
      "No free tier",
    ],
    bestFor: [
      "complex reasoning tasks",
      "code generation",
      "document analysis",
      "structured data extraction",
      "conversational AI",
    ],
    dataFreshness: "real-time",
    reliability: "high",
    alternatives: ["gemini", "huggingface"],
  },

  gemini: {
    id: "gemini",
    pricing: {
      model: "freemium",
      freeTier: "15 RPM, 1M tokens/day (Gemini Flash)",
      paidStartsAt: "$0.075/MTok input (Flash)",
      notes: "Generous free tier. Flash model is extremely cheap.",
    },
    rateLimits: { free: "15 req/min, 1M tokens/day", paid: "Higher limits" },
    strengths: [
      "Very generous free tier",
      "Fast inference (especially Flash)",
      "Multimodal (text, image, video, audio)",
      "Cheap paid pricing",
    ],
    weaknesses: [
      "Slightly behind Claude/GPT on complex reasoning",
      "API can be less stable than competitors",
    ],
    bestFor: [
      "budget-conscious AI apps",
      "multimodal tasks",
      "high-volume text generation",
      "prototyping and hackathons",
      "image understanding",
    ],
    dataFreshness: "real-time",
    reliability: "medium",
    alternatives: ["claude", "huggingface"],
  },

  huggingface: {
    id: "huggingface",
    pricing: {
      model: "freemium",
      freeTier: "Rate-limited free inference API",
      paidStartsAt: "$0.06/hour (dedicated endpoints)",
      notes: "Free tier for popular models. Thousands of models available.",
    },
    rateLimits: { free: "Rate-limited (varies by model load)", paid: "Dedicated capacity" },
    strengths: [
      "Thousands of specialized models",
      "Open-source models (Mistral, Llama, etc.)",
      "Text classification, NER, summarization, translation",
      "Free tier available",
    ],
    weaknesses: [
      "Free tier can be slow or unavailable for popular models",
      "Quality varies hugely between models",
      "Cold starts on free tier",
    ],
    bestFor: [
      "sentiment analysis",
      "text classification",
      "specialized NLP tasks",
      "open-source model access",
      "research and experimentation",
    ],
    dataFreshness: "real-time",
    reliability: "low",
    alternatives: ["claude", "gemini"],
  },

  coingecko: {
    id: "coingecko",
    pricing: {
      model: "freemium",
      freeTier: "10-30 calls/min (no key required)",
      paidStartsAt: "$129/mo (Analyst plan)",
      notes: "No key needed for basic usage. Best free crypto API.",
    },
    rateLimits: { free: "10-30 calls/min", paid: "500 calls/min" },
    strengths: [
      "No API key required for basic usage",
      "Comprehensive crypto coverage (14,000+ coins)",
      "Trending data, market overview, search",
      "Reliable and well-maintained",
    ],
    weaknesses: [
      "Rate limits on free tier",
      "No historical OHLCV on free tier",
      "Crypto-only (no stocks or forex)",
    ],
    bestFor: [
      "cryptocurrency prices",
      "crypto market overview",
      "trending coins",
      "crypto portfolio tracking",
      "market cap rankings",
    ],
    dataFreshness: "real-time",
    reliability: "high",
    alternatives: ["finnhub"],
  },

  finnhub: {
    id: "finnhub",
    pricing: {
      model: "freemium",
      freeTier: "60 calls/min",
      paidStartsAt: "$49/mo",
      notes: "Generous free tier for stocks. Real-time US stock data.",
    },
    rateLimits: { free: "60 calls/min", paid: "300 calls/min" },
    strengths: [
      "Real-time stock quotes",
      "Company news aggregation",
      "Forex exchange rates",
      "Market-wide news by category",
      "Good free tier",
    ],
    weaknesses: [
      "Requires API key",
      "US-focused stock data",
      "Limited crypto compared to CoinGecko",
    ],
    bestFor: [
      "stock prices and quotes",
      "financial news",
      "forex exchange rates",
      "market analysis",
      "investment dashboards",
    ],
    dataFreshness: "real-time",
    reliability: "high",
    alternatives: ["coingecko"],
  },

  charity: {
    id: "charity",
    pricing: {
      model: "free",
      freeTier: "Free with API key",
      paidStartsAt: null,
      notes: "Powered by Every.org. Free for nonprofit search.",
    },
    rateLimits: { free: "Reasonable limits", paid: null },
    strengths: [
      "Comprehensive U.S. nonprofit database",
      "Search by cause, name, or keyword",
      "Includes charity ratings and descriptions",
    ],
    weaknesses: [
      "U.S.-focused nonprofits only",
      "Requires API key",
      "Search-only (no donation API)",
    ],
    bestFor: [
      "nonprofit discovery",
      "cause-based search",
      "social impact apps",
      "donation platforms",
      "CSR tools",
    ],
    dataFreshness: "daily",
    reliability: "high",
    alternatives: [],
  },

  environment: {
    id: "environment",
    pricing: {
      model: "freemium",
      freeTier: "60 calls/min, 1M calls/mo",
      paidStartsAt: "From $0 (free) to custom pricing",
      notes: "Generous free tier. One of the most popular weather APIs.",
    },
    rateLimits: { free: "60 calls/min", paid: "Higher limits" },
    strengths: [
      "Current weather for any city worldwide",
      "Air quality index with pollutant breakdown",
      "Global coverage",
      "Well-documented and reliable",
    ],
    weaknesses: [
      "Requires API key",
      "Air quality requires lat/lon (not city name)",
      "Free tier doesn't include forecasts or historical",
    ],
    bestFor: [
      "weather data",
      "air quality monitoring",
      "environmental apps",
      "location-based services",
      "climate dashboards",
    ],
    dataFreshness: "real-time",
    reliability: "high",
    alternatives: [],
  },

  geoapify: {
    id: "geoapify",
    pricing: {
      model: "freemium",
      freeTier: "3,000 req/day (no credit card)",
      paidStartsAt: "$49/mo",
      notes: "Generous free tier. No credit card required.",
    },
    rateLimits: { free: "3,000 req/day", paid: "Higher limits" },
    strengths: [
      "Geocoding, reverse geocoding, and routing in one API",
      "No credit card for free tier",
      "Multiple travel modes (drive, walk, bicycle, transit)",
      "Good alternative to Google Maps",
    ],
    weaknesses: [
      "Less accurate than Google Maps in some regions",
      "Smaller ecosystem and community",
      "Requires API key",
    ],
    bestFor: [
      "geocoding addresses",
      "reverse geocoding",
      "route planning",
      "distance calculations",
      "location-based apps on a budget",
    ],
    dataFreshness: "near-real-time",
    reliability: "high",
    alternatives: [],
  },
};

/** Keywords mapped to provider IDs for intent matching */
export const intentKeywords: Record<string, string[]> = {
  // Health
  drug: ["openfda"],
  medication: ["openfda"],
  pharmaceutical: ["openfda"],
  fda: ["openfda"],
  recall: ["openfda"],
  "adverse event": ["openfda"],
  "side effect": ["openfda"],
  "mental health": ["mental_health"],
  crisis: ["mental_health"],
  suicide: ["mental_health"],
  anxiety: ["mental_health"],
  depression: ["mental_health"],
  hotline: ["mental_health"],
  therapy: ["mental_health"],
  counseling: ["mental_health"],
  wellness: ["mental_health"],

  // AI
  ai: ["claude", "gemini", "huggingface"],
  llm: ["claude", "gemini", "huggingface"],
  "language model": ["claude", "gemini", "huggingface"],
  chatbot: ["claude", "gemini"],
  "text generation": ["claude", "gemini", "huggingface"],
  reasoning: ["claude"],
  "code generation": ["claude"],
  sentiment: ["huggingface"],
  classification: ["huggingface"],
  "image understanding": ["gemini"],
  multimodal: ["gemini"],
  cheap: ["gemini", "huggingface"],
  "open source": ["huggingface"],

  // Finance
  stock: ["finnhub"],
  stocks: ["finnhub"],
  "stock price": ["finnhub"],
  equity: ["finnhub"],
  forex: ["finnhub"],
  "exchange rate": ["finnhub"],
  crypto: ["coingecko"],
  cryptocurrency: ["coingecko"],
  bitcoin: ["coingecko"],
  ethereum: ["coingecko"],
  "coin price": ["coingecko"],
  trending: ["coingecko"],
  "market cap": ["coingecko"],
  finance: ["finnhub", "coingecko"],
  financial: ["finnhub", "coingecko"],
  investment: ["finnhub", "coingecko"],

  // Social Impact
  nonprofit: ["charity"],
  charity: ["charity"],
  donation: ["charity"],
  "social impact": ["charity"],
  ngo: ["charity"],
  cause: ["charity"],

  // Environment
  weather: ["environment"],
  temperature: ["environment"],
  "air quality": ["environment"],
  pollution: ["environment"],
  aqi: ["environment"],
  climate: ["environment"],
  forecast: ["environment"],

  // Maps
  geocode: ["geoapify"],
  geocoding: ["geoapify"],
  address: ["geoapify"],
  directions: ["geoapify"],
  route: ["geoapify"],
  routing: ["geoapify"],
  distance: ["geoapify"],
  coordinates: ["geoapify"],
  map: ["geoapify"],
  location: ["geoapify"],
  navigation: ["geoapify"],
};

/** Category descriptions for broader matching */
export const categoryDescriptions: Record<string, string[]> = {
  physical_health: ["health", "medical", "drug", "pharmaceutical", "clinical"],
  mental_health: ["mental", "wellness", "crisis", "support", "therapy"],
  financial: ["finance", "money", "trading", "market", "investment", "crypto", "stock"],
  social_impact: ["social", "nonprofit", "charity", "giving", "impact"],
  environment: ["weather", "climate", "environment", "air", "pollution"],
  ai: ["ai", "ml", "language model", "chatbot", "nlp", "text generation"],
  maps: ["map", "location", "geocode", "route", "directions", "address"],
  cloud: ["cloud", "aws", "translation", "compute"],
};
