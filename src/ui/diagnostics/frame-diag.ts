/**
 * Console lines and errors a plugin frame sends for the diagnostics report.
 * The plugin id comes from the frame's connection, never from the message,
 * and a frame that sends too much is cut off for the rest of the minute.
 */
import { addConsole, addError, type ConsoleLevel } from "./store";

const PER_MINUTE = 300;
const LEVELS = new Set<ConsoleLevel>(["debug", "log", "info", "warn", "error"]);
const KINDS = new Set(["error", "rejection", "csp", "react"]);

const budgets = new Map<string, { resetAt: number; used: number }>();

function allow(pluginId: string, count: number): number {
  const now = Date.now();
  let budget = budgets.get(pluginId);
  if (!budget || budget.resetAt <= now) {
    budget = { resetAt: now + 60_000, used: 0 };
    budgets.set(pluginId, budget);
  }
  const room = Math.max(0, PER_MINUTE - budget.used);
  const take = Math.min(room, count);
  budget.used += take;
  return take;
}

function str(value: unknown, max = 4000): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function at(value: unknown): string | undefined {
  const text = str(value, 40);
  return text && !Number.isNaN(Date.parse(text)) ? text : undefined;
}

export function receiveFrameDiag(pluginId: string, data: unknown): void {
  if (!data || typeof data !== "object") return;
  const batch = data as { console?: unknown; errors?: unknown };
  const lines = Array.isArray(batch.console) ? batch.console.slice(0, 50) : [];
  const errors = Array.isArray(batch.errors) ? batch.errors.slice(0, 50) : [];
  let room = allow(pluginId, lines.length + errors.length);
  for (const raw of lines) {
    if (room <= 0) return;
    const line = (raw ?? {}) as Record<string, unknown>;
    const level = line.level as ConsoleLevel;
    const text = str(line.text);
    if (!LEVELS.has(level) || text === undefined) continue;
    addConsole({ level, text, source: pluginId, at: at(line.at) });
    room--;
  }
  for (const raw of errors) {
    if (room <= 0) return;
    const entry = (raw ?? {}) as Record<string, unknown>;
    const kind = entry.kind as "error" | "rejection" | "csp" | "react";
    const message = str(entry.message);
    if (!KINDS.has(kind) || message === undefined) continue;
    addError({
      kind,
      message,
      source: pluginId,
      at: at(entry.at),
      stack: str(entry.stack),
      where: str(entry.where, 500),
      directive: str(entry.directive, 100),
      blocked: str(entry.blocked, 300),
    });
    room--;
  }
}

/** Test seam. */
export function resetFrameDiagBudgets(): void {
  budgets.clear();
}
