// The 6 aggregators. Each gets you ONE key that unlocks N sub-providers via
// the matching enumerator. Recipes mirror the standalone shape so they can
// share the same Stagehand pipeline.
//
// All 6 expose email-only signup. OAuth (Google / GitHub) is also offered on
// some — the agent prompt tells it to prefer the email path when possible.

import type { Recipe } from "../lib/types.ts";

export const AGGREGATOR_RECIPES: Recipe[] = [
  {
    name: "openrouter",
    display_name: "OpenRouter (aggregator)",
    category: "ai",
    signup_url: "https://openrouter.ai/sign-up",
    dashboard_url: "https://openrouter.ai/settings/keys",
    needs_email_verify: true,
    extra_hint:
      "Prefer the email signup option, NOT Google or GitHub OAuth. After verifying email, click 'Create Key', name it 'pl-default', and copy the sk-or-v1-... value.",
    smoke_test: {
      url: "https://openrouter.ai/api/v1/models",
      headers: { Authorization: "Bearer {KEY}" },
    },
  },
  {
    name: "huggingface",
    display_name: "Hugging Face (aggregator)",
    category: "ai",
    signup_url: "https://huggingface.co/join",
    dashboard_url: "https://huggingface.co/settings/tokens",
    needs_email_verify: true,
    extra_hint:
      "After signup + email confirmation, on the tokens page click 'Create new token', name 'pl-default', leave it as a 'Read' (fine-grained NOT required) token, then copy the hf_... value.",
    smoke_test: {
      url: "https://huggingface.co/api/whoami-v2",
      headers: { Authorization: "Bearer {KEY}" },
    },
  },
  {
    name: "replicate",
    display_name: "Replicate (aggregator)",
    category: "ai",
    signup_url: "https://replicate.com/signin",
    dashboard_url: "https://replicate.com/account/api-tokens",
    needs_email_verify: false,
    extra_hint:
      "Replicate's primary path is GitHub OAuth — DO NOT use it. Click 'Sign up with email' (small link below the GitHub button). After signup, the default API token shows in the tokens table; reveal and copy the r8_... value.",
    smoke_test: {
      url: "https://api.replicate.com/v1/account",
      headers: { Authorization: "Token {KEY}" },
    },
  },
  {
    name: "fal",
    display_name: "Fal.ai (aggregator)",
    category: "ai",
    signup_url: "https://fal.ai/login",
    dashboard_url: "https://fal.ai/dashboard/keys",
    needs_email_verify: true,
    extra_hint:
      "Click 'Continue with Email' rather than Google/GitHub. After verifying, navigate to the API Keys page and create a new key. Copy the value (starts with the format api-key-id:secret).",
    smoke_test: {
      url: "https://rest.alpha.fal.ai/whoami",
      headers: { Authorization: "Key {KEY}" },
    },
  },
  {
    name: "together",
    display_name: "Together AI (aggregator)",
    category: "ai",
    signup_url: "https://api.together.ai/signup",
    dashboard_url: "https://api.together.ai/settings/api-keys",
    needs_email_verify: true,
    extra_hint:
      "Pick the email signup, not Google. Together provides a default API key on first login — copy it from the API Keys settings page.",
    smoke_test: {
      url: "https://api.together.xyz/v1/models",
      headers: { Authorization: "Bearer {KEY}" },
    },
  },
  {
    name: "apilayer",
    display_name: "APILayer (aggregator)",
    category: "utility",
    signup_url: "https://apilayer.com/auth/sign-up",
    dashboard_url: "https://apilayer.com/account",
    needs_email_verify: true,
    extra_hint:
      "Fill the signup form, verify email, then subscribe to any free product (e.g. 'Currency Data' free tier) so a key is issued. The key is shown on the Account page under 'API Keys'.",
    smoke_test: {
      url: "https://api.apilayer.com/exchangerates_data/latest?base=USD&symbols=EUR",
      headers: { apikey: "{KEY}" },
    },
  },
];
