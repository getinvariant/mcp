import "dotenv/config";

export const config = {
  // Provider API keys — set these once, users never see them
  alphaVantageKey: process.env.ALPHA_VANTAGE_API_KEY || "",
  openWeatherKey: process.env.OPENWEATHER_API_KEY || "",
  everyOrgKey: process.env.EVERY_ORG_API_KEY || "",
  openFdaKey: process.env.OPENFDA_API_KEY || "",
};
