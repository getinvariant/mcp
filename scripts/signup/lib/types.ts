// Shared types across the signup orchestrator.

export type Category =
  | "ai"
  | "weather"
  | "maps"
  | "news"
  | "finance"
  | "crypto"
  | "search"
  | "media"
  | "audio"
  | "vector_db"
  | "email_infra"
  | "nlp"
  | "utility";

export interface Recipe {
  name: string;                 // canonical provider id (snake-case)
  display_name: string;
  category: Category;
  signup_url: string;
  dashboard_url: string;        // where the API key is shown after signup
  /** Extra natural-language guidance appended to the agent prompt for this provider. */
  extra_hint?: string;
  /** Set true if confirming an email link is part of the signup flow. */
  needs_email_verify: boolean;
  /** OAuth-only signups can't be automated by the agent — skip. */
  oauth_only?: boolean;
  smoke_test: SmokeTest;
}

export interface SmokeTest {
  /** {KEY} is substituted with the captured api key, {Q} with a simple query word. */
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;  // {KEY} substitution works in values
  body?: string;
  expect_status?: number;            // default 200
  expect_body_contains?: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  category: Category;
  description: string;
  api_key: string;
  base_url?: string;
  auth_header?: string;             // e.g. "Authorization: Bearer {KEY}"
  /** Source aggregator if this provider is fronted by one, else "standalone". */
  source: string;
  /** Sample endpoint we know works — used for smoke testing. */
  sample_endpoint?: SmokeTest;
  /** When this row was created. */
  generated_at: string;
  /** Result of the most recent smoke test, if any. */
  smoke_ok?: boolean;
  smoke_error?: string;
}

export interface SignupResult {
  recipe: Recipe;
  ok: boolean;
  api_key?: string;
  email?: string;
  password?: string;
  error?: string;
  duration_ms: number;
}
