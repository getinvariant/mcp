import { Provider } from "./types.js";
import { OpenFDAProvider } from "./openfda.js";
import { MentalHealthProvider } from "./mental-health.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { HuggingFaceProvider } from "./huggingface.js";
import { EnvironmentProvider } from "./environment.js";
import { CoinGeckoProvider } from "./coingecko.js";
import { FinnhubProvider } from "./finnhub.js";
import { CharityProvider } from "./charity.js";
import { GeoapifyProvider } from "./geoapify.js";

const providers = new Map<string, Provider>();

function ensureInitialized() {
  if (providers.size > 0) return;
  const all: Provider[] = [
    // Health
    new OpenFDAProvider(),
    new MentalHealthProvider(),
    // AI
    new AnthropicProvider(),
    new GeminiProvider(),
    new HuggingFaceProvider(),
    // Finance
    new CoinGeckoProvider(),
    new FinnhubProvider(),
    // Social Impact
    new CharityProvider(),
    // Environment
    new EnvironmentProvider(),
    // Maps
    new GeoapifyProvider(),
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
