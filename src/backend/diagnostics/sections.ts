/**
 * Report sections plugins add with ctx.diagnostics.provide. Only admins read
 * them, and core masks and caps whatever a plugin hands back.
 */
import { redactData } from "../utils/logger.js";

export interface DiagnosticsSectionProvider {
  title?: string;
  collect: () => unknown;
}

export interface CollectedSection {
  pluginId: string;
  title: string;
  data?: unknown;
  error?: string;
}

export const SECTION_TIMEOUT_MS = 3000;
export const MAX_SECTION_BYTES = 64 * 1024;
const MAX_TITLE = 80;

const sections = new Map<string, DiagnosticsSectionProvider>();

/** One section per plugin; a second call replaces the first. */
export function provideDiagnosticsSection(
  pluginId: string,
  provider: DiagnosticsSectionProvider,
): () => void {
  if (typeof provider?.collect !== "function") {
    throw new Error("ctx.diagnostics.provide needs collect()");
  }
  const entry = {
    title:
      typeof provider.title === "string"
        ? provider.title.slice(0, MAX_TITLE)
        : undefined,
    collect: provider.collect,
  };
  sections.set(pluginId, entry);
  return () => {
    if (sections.get(pluginId) === entry) sections.delete(pluginId);
  };
}

export function hasDiagnosticsSection(pluginId: string): boolean {
  return sections.has(pluginId);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out")), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Plain JSON only, masked and cut to size. */
export function cleanSectionData(raw: unknown): unknown {
  let json: string | undefined;
  try {
    json = JSON.stringify(raw);
  } catch {
    return "[could not be read as JSON]";
  }
  if (json === undefined) return null;
  if (json.length > MAX_SECTION_BYTES) {
    return `[too big: ${json.length} bytes, the limit is ${MAX_SECTION_BYTES}]`;
  }
  return redactData(JSON.parse(json));
}

export async function collectDiagnosticsSections(
  only?: string,
  timeoutMs = SECTION_TIMEOUT_MS,
): Promise<CollectedSection[]> {
  const wanted = [...sections.entries()].filter(
    ([pluginId]) => !only || pluginId === only,
  );
  return Promise.all(
    wanted.map(async ([pluginId, provider]) => {
      const title = provider.title || pluginId;
      try {
        const data = await withTimeout(
          Promise.resolve().then(() => provider.collect()),
          timeoutMs,
        );
        return { pluginId, title, data: cleanSectionData(data) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          pluginId,
          title,
          error: String(redactData(message.slice(0, 500))),
        };
      }
    }),
  );
}

/** For tests. */
export function resetDiagnosticsSections(): void {
  sections.clear();
}
