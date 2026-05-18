export type Source =
  | "geoapify"
  | "mapbox"
  | "nominatim"
  | "openweather"
  | "openmeteo"
  | "coingecko"
  | "binance"
  | "finnhub"
  | "alphavantage";

export type TaskType =
  | "places:geocode"
  | "env:weather"
  | "finance:price:crypto"
  | "finance:price:stock";

export type RouteFetchRequest = {
  source: Source;
  task_type: TaskType;
  params: Record<string, any>;
};

export type RouteFetchResponse = {
  ok: boolean;
  status: number;
  body: any;
  routed_to: string;
  original: string;
  call_index: number;
  context: string;
  rates_after: Record<string, number>;
};

export type InstallOpts = {
  pl_key: string;
  base_url?: string;
  verbose?: boolean;
};
