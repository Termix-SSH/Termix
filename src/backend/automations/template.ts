/**
 * Variable substitution for automation steps.
 *
 * Templates read from the run context: {{host.name}}, {{trigger.value}},
 * {{steps.<stepId>.stdout}}, {{vars.myVar}}. Resolution always produces a
 * plain string and never shell syntax; callers that build a command are
 * responsible for quoting the result (see shellSingleQuote in
 * hosts/metrics/managers/exec-elevated.ts). Nothing here escapes anything,
 * precisely so there is one obvious place where quoting happens.
 */

export interface TemplateContext {
  host?: {
    id?: number;
    name?: string;
    ip?: string;
    username?: string;
    port?: number;
  };
  trigger?: Record<string, unknown>;
  steps?: Record<string, { stdout?: string; stderr?: string; code?: number }>;
  vars?: Record<string, string>;
  run?: { id?: number; automationId?: number; startedAt?: string };
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

function readPath(context: TemplateContext, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = context;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Replaces every {{token}} it can resolve. An unresolvable token is left
 * as-is so a typo shows up in the run output rather than silently becoming an
 * empty string, which is the difference between a visible mistake and a
 * command that quietly does the wrong thing.
 */
export function renderTemplate(
  input: string,
  context: TemplateContext,
): string {
  if (!input || !input.includes("{{")) return input;

  return input.replace(TOKEN, (match, path: string) => {
    const value = readPath(context, path);
    return value === undefined ? match : stringify(value);
  });
}

/** Renders every string in a flat record, leaving keys untouched. */
export function renderRecord(
  input: Record<string, string> | undefined,
  context: TemplateContext,
): Record<string, string> | undefined {
  if (!input) return undefined;
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = renderTemplate(value, context);
  }
  return output;
}

/** True when a template still has unresolved tokens after rendering. */
export function hasUnresolvedTokens(rendered: string): boolean {
  TOKEN.lastIndex = 0;
  return TOKEN.test(rendered);
}

const SECRET_KEY = /(authorization|token|password|secret|api[-_]?key|cookie)/i;

/**
 * Masks values whose key looks like a credential, for anything written to run
 * history or returned by the API.
 */
export function redactSecrets(
  input: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!input) return undefined;
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = SECRET_KEY.test(key) ? "***" : value;
  }
  return output;
}
