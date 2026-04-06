import { Provider } from "./types.js";
import { OpenFDAProvider } from "./openfda.js";
import { MentalHealthProvider } from "./mental-health.js";
import { AlphaVantageProvider } from "./alpha-vantage.js";
import { CharityProvider } from "./charity.js";
import { EnvironmentProvider } from "./environment.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";
import { HuggingFaceProvider } from "./huggingface.js";
import { AWSProvider } from "./aws.js";
import { GoogleCloudProvider } from "./google-cloud.js";
import { OpenStreetMapProvider } from "./openstreetmap.js";
import { GoogleMapsProvider } from "./google-maps.js";

const providers = new Map<string, Provider>();

function ensureInitialized() {
  if (providers.size > 0) return;
  const all: Provider[] = [
    // Health
    new OpenFDAProvider(),
    new MentalHealthProvider(),
    // Financial
    new AlphaVantageProvider(),
    // Social Impact
    new CharityProvider(),
    // Environment
    new EnvironmentProvider(),
    // AI
    new AnthropicProvider(),
    new OpenAIProvider(),
    new GeminiProvider(),
    new HuggingFaceProvider(),
    // Cloud
    new AWSProvider(),
    new GoogleCloudProvider(),
    // Maps
    new OpenStreetMapProvider(),
    new GoogleMapsProvider(),
  ];
  for (const p of all) {
    providers.set(p.info.id, p);
  }
}

export function getProvider(id: string): Provider | undefined {
  ensureInitialized();
  return providers.get(id);
}

export function getAllProviders(): Provider[] {
  ensureInitialized();
  return Array.from(providers.values());
}
