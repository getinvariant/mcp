import { Provider } from "./types.js";
import { OpenFDAProvider } from "./openfda.js";
import { MentalHealthProvider } from "./mental-health.js";
import { AlphaVantageProvider } from "./alpha-vantage.js";
import { CharityProvider } from "./charity.js";
import { EnvironmentProvider } from "./environment.js";

const providers = new Map<string, Provider>();

export async function initializeRegistry(): Promise<void> {
  const all: Provider[] = [
    new OpenFDAProvider(),
    new MentalHealthProvider(),
    new AlphaVantageProvider(),
    new CharityProvider(),
    new EnvironmentProvider(),
  ];

  for (const provider of all) {
    await provider.initialize();
    providers.set(provider.info.id, provider);
  }
}

export function getProvider(id: string): Provider | undefined {
  return providers.get(id);
}

export function getAllProviders(): Provider[] {
  return Array.from(providers.values());
}
