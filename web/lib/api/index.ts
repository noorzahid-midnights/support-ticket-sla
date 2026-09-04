import type { HelpdeskApi } from "./types";
import { mockApi } from "./mock";
import { httpApi } from "./http";

export const API_MODE = process.env.NEXT_PUBLIC_API_MODE === "http" ? "http" : "mock";

// Both implementations are imported eagerly and picked here rather than
// dynamically, so a typo in the env var can never produce a half-loaded api.
export const api: HelpdeskApi = API_MODE === "http" ? httpApi : mockApi;

export type * from "./types";
