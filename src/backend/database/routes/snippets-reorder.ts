export interface SnippetReorderUpdate {
  id: number;
  order: number;
  folder?: string;
}

type SnippetReorderRequestBody = {
  snippets?: unknown;
  updates?: unknown;
};

export function extractSnippetReorderUpdates(
  body: unknown,
): SnippetReorderUpdate[] | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const payload = body as SnippetReorderRequestBody;
  // Keep accepting the legacy `updates` key so older clients do not break
  // while the web and desktop helpers converge on `snippets`.
  const snippetsUpdates = Array.isArray(payload.snippets)
    ? payload.snippets
    : Array.isArray(payload.updates)
      ? payload.updates
      : null;

  if (!snippetsUpdates) {
    return null;
  }

  return snippetsUpdates as SnippetReorderUpdate[];
}
