import { safeOutboundFetch } from "./safe-outbound-fetch.js";

/**
 * The slice of the 1Password Connect REST API needed to resolve a secret
 * reference: find the vault, find the item, read one field.
 * https://developer.1password.com/docs/connect/api-reference
 */

export interface SecretReference {
  vault: string;
  item: string;
  field: string;
}

const FETCH_TIMEOUT_MS = 10_000;

/** op://<vault>/<item>/<field>  (a trailing ?query, as in ?ssh-format=openssh, is ignored) */
export function parseSecretReference(raw: string): SecretReference | null {
  const match = /^op:\/\/([^/]+)\/([^/]+)\/([^/?]+)(?:\?.*)?$/.exec(raw.trim());
  if (!match) return null;
  const [, vault, item, field] = match.map((part) => decodeURIComponent(part));
  return { vault, item, field };
}

export function isSecretReference(value: unknown): value is string {
  return typeof value === "string" && value.trimStart().startsWith("op://");
}

export interface ConnectSource {
  baseUrl: string;
  token: string;
  allowedPrivateHosts: readonly string[];
}

async function connectGet<T>(source: ConnectSource, path: string): Promise<T> {
  const base = source.baseUrl.replace(/\/+$/, "");
  const response = await safeOutboundFetch(
    `${base}${path}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${source.token}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
    source.allowedPrivateHosts,
  );
  if (!response.ok) {
    throw new Error(`1Password Connect ${path} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function eqFilter(value: string): string {
  return encodeURIComponent(`title eq "${value.replace(/"/g, '\\"')}"`);
}

interface ConnectVault {
  id: string;
  name: string;
}
interface ConnectItemSummary {
  id: string;
  title: string;
}
interface ConnectField {
  id: string;
  label?: string;
  purpose?: string;
  type?: string;
  value?: string;
}

/** Reachability + token validity: the vault list needs a valid token. */
export async function testConnectSource(source: ConnectSource): Promise<number> {
  const vaults = await connectGet<ConnectVault[]>(source, "/v1/vaults");
  return vaults.length;
}

const byIdOrName = (name: string) => (candidate: { id: string; name?: string; title?: string }) =>
  candidate.id === name ||
  (candidate.name ?? candidate.title ?? "").toLowerCase() === name.toLowerCase();

export async function resolveConnectReference(
  source: ConnectSource,
  ref: SecretReference,
): Promise<string> {
  const vaults = await connectGet<ConnectVault[]>(
    source,
    `/v1/vaults?filter=${eqFilter(ref.vault)}`,
  );
  const vault =
    vaults.find(byIdOrName(ref.vault)) ??
    (await connectGet<ConnectVault[]>(source, "/v1/vaults")).find(
      byIdOrName(ref.vault),
    );
  if (!vault) throw new Error(`1Password vault "${ref.vault}" not found`);

  const items = await connectGet<ConnectItemSummary[]>(
    source,
    `/v1/vaults/${vault.id}/items?filter=${eqFilter(ref.item)}`,
  );
  const summary =
    items.find(byIdOrName(ref.item)) ??
    (ref.item.length >= 26 ? { id: ref.item, title: ref.item } : undefined);
  if (!summary) {
    throw new Error(`1Password item "${ref.item}" not found in "${ref.vault}"`);
  }

  const item = await connectGet<{ fields?: ConnectField[] }>(
    source,
    `/v1/vaults/${vault.id}/items/${summary.id}`,
  );
  const wanted = ref.field.toLowerCase();
  const field = (item.fields ?? []).find(
    (f) =>
      f.id === ref.field ||
      f.label?.toLowerCase() === wanted ||
      f.purpose?.toLowerCase() === wanted ||
      (wanted === "private key" && f.id === "private_key") ||
      (wanted === "private_key" && f.label?.toLowerCase() === "private key"),
  );
  if (!field || field.value === undefined) {
    throw new Error(
      `1Password field "${ref.field}" not found on "${ref.item}"`,
    );
  }
  return field.value;
}
