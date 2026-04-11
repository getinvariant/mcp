export enum ProviderCategory {
  PHYSICAL_HEALTH = "physical_health",
  MENTAL_HEALTH = "mental_health",
  FINANCIAL = "financial",
  SOCIAL_IMPACT = "social_impact",
  ENVIRONMENT = "environment",
  AI = "ai",
  MAPS = "maps",
  CLOUD = "cloud",
  EDUCATION = "education",
  CREATIVE = "creative",
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
  requiresApiKey: boolean;
}

export interface QueryResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface Provider {
  info: ProviderInfo;
  isAvailable(): boolean;
  query(action: string, params: Record<string, unknown>): Promise<QueryResult>;
}
