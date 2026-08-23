import { fetchWithProxy } from "../../utils/proxy-agent.js";
import { safeOutboundFetch } from "../../utils/safe-outbound-fetch.js";
import { evaluateEgress, readPrivateAllowlist } from "../egress.js";
import { AiProviderError } from "./types.js";

/**
 * Every outbound provider request goes through here so the egress rules cannot
 * be bypassed by an adapter calling fetch directly.
 *
 * Public hosts use safeOutboundFetch, which re-checks the resolved address at
 * connect time. Allowlisted private hosts cannot use it (its whole job is to
 * refuse them), so they use the installed Undici fetch implementation with
 * its matching proxy dispatcher -- still respecting proxy configuration.
 */
export async function providerFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const allowlist = await readPrivateAllowlist();
  const decision = evaluateEgress(url, allowlist);

  if (!decision.allowed) {
    throw new AiProviderError(decision.reason ?? "Destination not allowed");
  }

  if (decision.isPrivate) {
    return fetchWithProxy(url, init);
  }

  return safeOutboundFetch(url, init) as unknown as Promise<Response>;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Yields the data payload of each SSE frame. Providers differ in what they put
 * inside, so parsing the JSON is left to the caller.
 */
export async function* readSseLines(
  response: Response,
): AsyncGenerator<string> {
  const body = response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith("data:")) {
          yield line.slice(5).trim();
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Yields one parsed JSON object per line, for newline-delimited streams. */
export async function* readJsonLines(
  response: Response,
): AsyncGenerator<unknown> {
  const body = response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          try {
            yield JSON.parse(line);
          } catch {
            // A partial or malformed frame is skipped rather than failing the
            // whole stream.
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Digs the human-readable message out of an error body.
 *
 * Every provider nests it differently, and dumping the raw JSON produced
 * something that got cut off mid-sentence. Falls back to a trimmed snippet
 * when the shape is unfamiliar.
 */
function extractProviderMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const message =
      parsed?.error?.message ??
      parsed?.error?.["message"] ??
      parsed?.message ??
      (typeof parsed?.error === "string" ? parsed.error : null);
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  } catch {
    // Not JSON; fall through to the snippet.
  }

  const trimmed = body.trim();
  if (!trimmed) return "";
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed;
}

export async function assertOk(
  response: Response,
  provider: string,
): Promise<void> {
  if (response.ok) return;

  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "";
  }

  const detail = extractProviderMessage(body);

  // Rate limits and auth failures are the two the user can actually act on,
  // so they say what to do instead of reading like an internal failure.
  if (response.status === 429) {
    throw new AiProviderError(
      `${provider} rate limit reached. Wait a moment and try again, or check your plan's quota.${
        detail ? ` (${detail})` : ""
      }`,
      429,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new AiProviderError(
      `${provider} rejected the API key. Check that it is correct and still active.${
        detail ? ` (${detail})` : ""
      }`,
      response.status,
    );
  }

  throw new AiProviderError(
    `${provider} request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    response.status,
  );
}
