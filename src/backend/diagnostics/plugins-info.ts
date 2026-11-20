/**
 * Every installed plugin as the server sees it: saved state, loader state,
 * its process and recent errors. Errors are masked.
 */
import { redactText } from "../utils/logger.js";
import { hasDiagnosticsSection } from "./sections.js";

export interface PluginDiagnostics {
  id: string;
  version: string;
  source: string | null;
  enabled: string | null;
  loader: string | null;
  sandboxed: boolean | null;
  signedTier: string | null;
  lastError: string | null;
  recentErrors: number;
  capabilities: string[];
  engine: Record<string, string>;
  process: {
    state: string;
    crashes: number;
    rssMb: number | null;
    readyMs: number | null;
    keepOnReason: string | null;
  } | null;
  section: boolean;
}

function clean(text: string | null | undefined): string | null {
  return text ? redactText(text).slice(0, 2000) : null;
}

export async function describePlugins(): Promise<{
  plugins: PluginDiagnostics[];
  skipped: { id: string; version: string | null; error: string }[];
}> {
  const { createCurrentPluginRepository } =
    await import("../database/repositories/factory.js");
  const { getPluginRuntime } = await import("../plugins/index.js");
  const { getSandboxSupervisor } =
    await import("../plugins/sandbox/supervisor.js");

  const records = await createCurrentPluginRepository().listAll();
  const { loader } = getPluginRuntime();
  const live = new Map(loader.list().map((plugin) => [plugin.id, plugin]));
  let statuses: ReturnType<ReturnType<typeof getSandboxSupervisor>["status"]> =
    [];
  try {
    statuses = getSandboxSupervisor().status();
  } catch {
    statuses = [];
  }
  const processes = new Map(statuses.map((s) => [s.pluginId, s]));
  const ids = new Set([...records.map((r) => r.id), ...live.keys()]);

  const plugins = [...ids].sort().map((id): PluginDiagnostics => {
    const record = records.find((r) => r.id === id);
    const loaded = live.get(id);
    const proc = processes.get(id);
    let capabilities: string[] = loaded?.manifest.capabilities ?? [];
    let engine: Record<string, string> = {};
    try {
      const manifest = record
        ? (JSON.parse(record.manifestJson) as {
            capabilities?: unknown;
            engine?: Record<string, unknown>;
          })
        : null;
      if (!loaded && Array.isArray(manifest?.capabilities)) {
        capabilities = manifest.capabilities.filter(
          (c): c is string => typeof c === "string",
        );
      }
      for (const [key, value] of Object.entries(manifest?.engine ?? {})) {
        if (typeof value === "string") engine[key] = value;
      }
    } catch {
      engine = {};
    }
    return {
      id,
      version: loaded?.manifest.version ?? record?.version ?? "unknown",
      source: loaded?.source ?? record?.source ?? null,
      enabled: record?.state ?? null,
      loader: loaded?.state ?? null,
      sandboxed: loaded?.sandboxed ?? null,
      signedTier: loaded?.signedTier ?? null,
      lastError: clean(loaded?.lastError ?? record?.lastError),
      recentErrors: loaded?.errorTimestamps.length ?? 0,
      capabilities: [...capabilities].sort(),
      engine,
      process: proc
        ? {
            state: proc.state,
            crashes: proc.crashes,
            rssMb: proc.rssMb,
            readyMs: proc.readyMs ?? null,
            keepOnReason: proc.keepOnReason,
          }
        : null,
      section: hasDiagnosticsSection(id),
    };
  });

  const skipped = loader.skipped().map((entry) => ({
    id: entry.id,
    version: entry.version,
    error: clean(entry.error) ?? "",
  }));

  return { plugins, skipped };
}
