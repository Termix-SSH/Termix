/** Public project key. Only lets a client send events, never read them. */
export const DEFAULT_POSTHOG_API_KEY =
  "phc_xM8UznirsFxUkGE68gH4jzeqevf4kh76wGw7Ci7hH2dd";
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

type Env = Record<string, string | undefined>;

/** ENABLE_TELEMETRY wins over the admin setting when set. */
export function envOverride(env: Env = process.env): boolean | null {
  const value = env.ENABLE_TELEMETRY?.trim().toLowerCase();
  if (!value) return null;
  return value === "true";
}

export function posthogConfig(env: Env = process.env): {
  apiKey: string;
  host: string;
} {
  return {
    apiKey: env.POSTHOG_API_KEY?.trim() || DEFAULT_POSTHOG_API_KEY,
    host: (env.POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST).replace(
      /\/+$/,
      "",
    ),
  };
}
