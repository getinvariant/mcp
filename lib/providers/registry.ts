import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Provider } from "./types.js";
import { loadGeneratedProviders } from "./generic.js";
import { OpenFDAProvider } from "./openfda.js";
import { MentalHealthProvider } from "./mental-health.js";
import { NPPESProvider } from "./nppes.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { HuggingFaceProvider } from "./huggingface.js";
import { EnvironmentProvider } from "./environment.js";
import { CoinGeckoProvider } from "./coingecko.js";
import { FinnhubProvider } from "./finnhub.js";
import { WorldBankProvider } from "./world-bank.js";
import { CharityProvider } from "./charity.js";
import { GeoapifyProvider } from "./geoapify.js";
import { GoogleMapsProvider } from "./google-maps.js";
import { MapboxProvider } from "./mapbox.js";
import { OpenStreetMapProvider } from "./openstreetmap.js";
import { AlphaVantageProvider } from "./alpha-vantage.js";
import { BinanceProvider } from "./binance.js";
import { OpenMeteoProvider } from "./open-meteo.js";
import { OpenLibraryProvider } from "./open-library.js";
import { KhanAcademyProvider } from "./khan-academy.js";
import { UnsplashProvider } from "./unsplash.js";
import { ArtInstituteProvider } from "./art-institute.js";
import { TwilioProvider } from "./twilio.js";

const providers = new Map<string, Provider>();

function ensureInitialized() {
  if (providers.size > 0) return;
  const all: Provider[] = [
    // Health
    new OpenFDAProvider(),
    new MentalHealthProvider(),
    new NPPESProvider(),
    // AI
    new AnthropicProvider(),
    new GeminiProvider(),
    new HuggingFaceProvider(),
    // Finance
    new CoinGeckoProvider(),
    new FinnhubProvider(),
    new BinanceProvider(),
    new AlphaVantageProvider(),
    new WorldBankProvider(),
    // Social Impact
    new CharityProvider(),
    // Environment
    new EnvironmentProvider(),
    new OpenMeteoProvider(),
    // Maps — paid rivals (google_maps, mapbox) + free fallbacks
    new GoogleMapsProvider(),
    new GeoapifyProvider(),
    new MapboxProvider(),
    new OpenStreetMapProvider(),
    // Education
    new OpenLibraryProvider(),
    new KhanAcademyProvider(),
    // Creative
    new UnsplashProvider(),
    new ArtInstituteProvider(),
    // Communications (hard-to-onboard, fronted by Invariant's A2P registration)
    new TwilioProvider(),
  ];
  for (const p of all) {
    providers.set(p.info.id, p);
  }

  // Load auto-provisioned providers from the signup orchestrator output.
  // File ships alongside the source so production deploys pick it up.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(here, "../../scripts/signup/data/generated-providers.json"),
      resolve(here, "../../../scripts/signup/data/generated-providers.json"),
    ];
    const path = candidates.find((p) => existsSync(p));
    if (path) {
      const rows = JSON.parse(readFileSync(path, "utf8")) as any[];
      for (const p of loadGeneratedProviders(rows)) {
        // Don't overwrite hand-written providers if ids collide.
        if (!providers.has(p.info.id)) providers.set(p.info.id, p);
      }
    }
  } catch (err) {
    // Generated catalog is optional; only log so we don't crash startup.
    console.warn(
      `[providers] generated catalog not loaded: ${(err as Error).message}`,
    );
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
