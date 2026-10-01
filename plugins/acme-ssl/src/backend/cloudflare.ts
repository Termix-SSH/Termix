import type { PluginFetch } from "@termix/plugin-sdk/backend";

const API = "https://api.cloudflare.com/client/v4";

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: Array<{ message?: string }>;
  result: T;
}

async function call<T>(
  fetch: PluginFetch,
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const payload = (await response
    .json()
    .catch(() => null)) as CloudflareEnvelope<T> | null;
  if (!response.ok || !payload?.success) {
    const reason =
      payload?.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join("; ") || `HTTP ${response.status}`;
    throw new Error(`Cloudflare API error: ${reason}`);
  }
  return payload.result;
}

/** The zone holding `name`, found by trying each parent domain. */
export async function findZoneId(
  fetch: PluginFetch,
  token: string,
  name: string,
): Promise<string> {
  const labels = name.replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    const zones = await call<Array<{ id: string; name: string }>>(
      fetch,
      token,
      `/zones?name=${encodeURIComponent(candidate)}`,
    );
    const zone = zones.find((entry) => entry.name === candidate);
    if (zone) return zone.id;
  }
  throw new Error(`No Cloudflare zone found for ${name}`);
}

/** Creates the TXT record and returns a function that deletes it. */
export async function createTxtRecord(
  fetch: PluginFetch,
  token: string,
  name: string,
  content: string,
): Promise<() => Promise<void>> {
  const zoneId = await findZoneId(fetch, token, name);
  const record = await call<{ id: string }>(
    fetch,
    token,
    `/zones/${zoneId}/dns_records`,
    { method: "POST", body: { type: "TXT", name, content, ttl: 120 } },
  );
  return async () => {
    await call(fetch, token, `/zones/${zoneId}/dns_records/${record.id}`, {
      method: "DELETE",
    });
  };
}
