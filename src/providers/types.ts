export enum ProviderCategory {
  PHYSICAL_HEALTH = "physical_health",
  MENTAL_HEALTH = "mental_health",
  FINANCIAL = "financial",
  SOCIAL_IMPACT = "social_impact",
  ENVIRONMENT = "environment",
}

export interface ActionInfo {
  action: string;
  description: string;
  parameters: Record<string, ParameterInfo>;
}

export interface ParameterInfo {
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  category: ProviderCategory;
  description: string;
  availableActions: ActionInfo[];
  costPerQuery: number;
  rateLimitPerMinute: number;
  requiresApiKey: boolean;
  apiKeyEnvVar?: string;
}

export interface QueryResult {
  success: boolean;
  data?: unknown;
  error?: string;
  creditsUsed: number;
}

export interface Provider {
  info: ProviderInfo;
  initialize(): Promise<void>;
  isAvailable(): boolean;
  query(action: string, params: Record<string, unknown>): Promise<QueryResult>;
}
