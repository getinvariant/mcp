import "dotenv/config";

export const config = {
  demoKey: process.env.PROCUREMENT_LABS_DEMO_KEY || "pl_demo_key_2026",
  alphaVantageKey: process.env.ALPHA_VANTAGE_API_KEY || "",
  openWeatherKey: process.env.OPENWEATHER_API_KEY || "",
  everyOrgKey: process.env.EVERY_ORG_API_KEY || "",
  openFdaKey: process.env.OPENFDA_API_KEY || "",
  defaultBalance: 1000,
  rateLimitPerMinute: 60,
};
