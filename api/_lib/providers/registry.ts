import { Provider } from "./types.js";
import { OpenFDAProvider } from "./openfda.js";
import { MentalHealthProvider } from "./mental-health.js";
import { AlphaVantageProvider } from "./alpha-vantage.js";
import { CharityProvider } from "./charity.js";
import { EnvironmentProvider } from "./environment.js";

const providers = new Map<string, Provider>();

function ensureInitialized() {
  if (providers.size > 0) return;
  const all: Provider[] = [
    new OpenFDAProvider(),
    new MentalHealthProvider(),
    new AlphaVantageProvider(),
    new CharityProvider(),
    new EnvironmentProvider(),
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
