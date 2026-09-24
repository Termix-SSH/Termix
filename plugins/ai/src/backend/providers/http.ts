import type { PluginFetch } from "@termix/plugin-sdk/backend";
import { evaluateEgress, PRIVATE_DESTINATION_MESSAGE } from "../egress.js";
import { AiProviderError, type ProviderFetch } from "./types.js";

/** A model can take a while to load before the first token. */
const PROVIDER_TIMEOUT_MS = 10 * 60 * 1000;

function toHeaderRecord(
  headers: RequestInit["headers"] | undefined,
): Record<string, string> {
  const record: Record<string, string> = {};
  new Headers(headers ?? {}).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

/**
 * Every outbound provider request goes through here so the egress rules cannot
 * be bypassed by an adapter calling fetch directly. The actual request is
 * ctx.fetch, which pins DNS and refuses private addresses unless the host is
 * on the admin allowlist.
 */
export function createProviderFetch(
  fetch: PluginFetch,
  allowlist: string[],
): ProviderFetch {
  return async (url, init) => {
    const decision = evaluateEgress(url, allowlist);
    if (!decision.allowed) {
      throw new AiProviderError(decision.reason ?? "Destination not allowed");
    }

    if (
      init.body !== undefined &&
      init.body !== null &&
      typeof init.body !== "string"
    ) {
      throw new AiProviderError("Provider requests must send a text body");
    }

    try {
      return await fetch(url, {
        method: init.method ?? "GET",
        headers: toHeaderRecord(init.headers),
        body: (init.body as string | null | undefined) ?? undefined,
        signal: init.signal ?? undefined,
        timeoutMs: PROVIDER_TIMEOUT_MS,
        allowPrivateHosts: allowlist,
      });
    } catch (error) {
      // A hostname that resolved to a private address is refused after DNS,
      // which the check above cannot see coming.
      const message = error instanceof Error ? error.message : "";
      if (/private destinations/i.test(message)) {
        throw new AiProviderError(PRIVATE_DESTINATION_MESSAGE);
      }
      throw error;
    }
  };
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
