/**
 * WebAuthn steps a plugin's own screens ask the shell to run (adding a
 * passkey, proving a key). Frames can't reach navigator.credentials, so the
 * shell does: it asks here for the options, runs the browser prompt and sends
 * the answer back. The plugin's backend makes the options and checks the
 * answer; the frame never sees either. A ceremony is looked up under the
 * plugin id the shell gives (the frame's own), and each run is tied to the
 * person and session that started it.
 */

import crypto from "node:crypto";
import { getWebAuthnCeremony } from "./registry.js";
import { checkWebAuthnOptions } from "./login-descriptors.js";

const RUN_TTL_MS = 5 * 60 * 1000;
const MAX_RUNS = 1000;
const MAX_EXTRA = 4 * 1024;
const MAX_RESPONSE = 64 * 1024;
const MAX_RESULT = 16 * 1024;

export class CeremonyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Run {
  pluginId: string;
  ceremonyId: string;
  userId: string;
  sessionId?: string;
  origin: string;
  extra: Record<string, unknown>;
  context: Record<string, unknown>;
  expiresAt: number;
}

const runs = new Map<string, Run>();

function isPlain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Plain values only (text, numbers, true or false), small. */
export function readExtra(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isPlain(value)) throw new CeremonyError("Bad ceremony input", 400);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) continue;
    if (
      typeof item === "string" ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    ) {
      out[key] = item;
    }
  }
  if (JSON.stringify(out).length > MAX_EXTRA) {
    throw new CeremonyError("Ceremony input is too large", 400);
  }
  return out;
}

function plainJson(value: unknown, max: number): Record<string, unknown> {
  if (!isPlain(value)) return {};
  const text = JSON.stringify(value);
  if (text.length > max) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function sweep(now: number): void {
  for (const [ticket, run] of runs) {
    if (run.expiresAt <= now) runs.delete(ticket);
  }
  while (runs.size >= MAX_RUNS) runs.delete(runs.keys().next().value!);
}

export async function startCeremony(input: {
  pluginId: string;
  ceremonyId: string;
  userId: string;
  sessionId?: string;
  origin: string;
  extra: unknown;
}): Promise<{
  ticket: string;
  type: "create" | "get";
  publicKey: Record<string, unknown>;
}> {
  const ceremony = getWebAuthnCeremony(input.pluginId, input.ceremonyId);
  if (!ceremony) throw new CeremonyError("Not found", 404);
  const extra = readExtra(input.extra);
  const options = checkWebAuthnOptions(
    await ceremony.options({
      userId: input.userId,
      origin: input.origin,
      extra,
    }),
  );
  if (!options) throw new CeremonyError("The plugin gave no options", 502);
  const now = Date.now();
  sweep(now);
  const ticket = crypto.randomBytes(24).toString("hex");
  runs.set(ticket, {
    pluginId: input.pluginId,
    ceremonyId: input.ceremonyId,
    userId: input.userId,
    sessionId: input.sessionId,
    origin: input.origin,
    extra,
    context: options.context ?? {},
    expiresAt: now + RUN_TTL_MS,
  });
  return { ticket, type: ceremony.type, publicKey: options.publicKey };
}

export async function finishCeremony(input: {
  pluginId: string;
  ceremonyId: string;
  ticket: unknown;
  userId: string;
  sessionId?: string;
  response: unknown;
}): Promise<Record<string, unknown>> {
  const run = typeof input.ticket === "string" ? runs.get(input.ticket) : null;
  // One use only, whatever happens next.
  if (run) runs.delete(input.ticket as string);
  if (
    !run ||
    run.expiresAt <= Date.now() ||
    run.pluginId !== input.pluginId ||
    run.ceremonyId !== input.ceremonyId ||
    run.userId !== input.userId ||
    (run.sessionId && run.sessionId !== input.sessionId)
  ) {
    throw new CeremonyError("This step expired, try again", 410);
  }
  const ceremony = getWebAuthnCeremony(run.pluginId, run.ceremonyId);
  if (!ceremony) throw new CeremonyError("Not found", 404);
  const response = plainJson(input.response, MAX_RESPONSE);
  if (typeof response.id !== "string" || !isPlain(response.response)) {
    throw new CeremonyError("Bad browser answer", 400);
  }
  const result = await ceremony.finish({
    userId: run.userId,
    origin: run.origin,
    extra: run.extra,
    context: run.context,
    response,
  });
  return plainJson(result ?? {}, MAX_RESULT);
}

/** Test seam. */
export function resetCeremonies(): void {
  runs.clear();
}
