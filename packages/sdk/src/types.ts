export type Source = "geoapify" | "mapbox" | "nominatim";
export type TaskType = "places:geocode";

export type RouteFetchRequest = {
  source: Source;
  task_type: TaskType;
  params: { text: string; [k: string]: any };
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
