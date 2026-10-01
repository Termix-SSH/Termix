import { randomUUID } from "node:crypto";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { envOverride, posthogConfig } from "./config.js";
import { buildPayload, isEnabled, readSettings } from "./collect.js";
import type { UsageStore } from "./usage.js";

export const REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Checked hourly, so a restart never skips or doubles a day. */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;

const STATE_KEY = "state";

export interface ReporterState {
  lastSentAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

export type SendResult =
  { sent: true } | { sent: false; reason: "disabled" | "not-due" };

type Env = Record<string, string | undefined>;

export function createReporter(
  ctx: PluginContext,
  usage: UsageStore,
  env: Env = process.env,
  now: () => number = Date.now,
) {
  async function state(): Promise<ReporterState> {
    const stored = (await ctx.kv.get(STATE_KEY)) as
      Partial<ReporterState> | undefined;
    return {
      lastSentAt: stored?.lastSentAt ?? null,
      lastAttemptAt: stored?.lastAttemptAt ?? null,
      lastError: stored?.lastError ?? null,
    };
  }

  async function saveState(patch: Partial<ReporterState>) {
    await ctx.kv.set(STATE_KEY, { ...(await state()), ...patch });
  }

  async function nextDueAt(): Promise<string | null> {
    const { lastSentAt } = await state();
    if (!lastSentAt) return null;
    return new Date(Date.parse(lastSentAt) + REPORT_INTERVAL_MS).toISOString();
  }

  async function send(options: { force?: boolean } = {}): Promise<SendResult> {
    if (!isEnabled(await readSettings(ctx), env)) {
      return { sent: false, reason: "disabled" };
    }
    if (!options.force) {
      const due = await nextDueAt();
      if (due && Date.parse(due) > now()) {
        return { sent: false, reason: "not-due" };
      }
    }

    const attemptAt = new Date(now()).toISOString();
    const { apiKey, host } = posthogConfig(env);
    try {
      const { payload, usage: carried } = await buildPayload(ctx, usage, env);
      const response = await ctx.fetch(`${host}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, ...payload }),
        timeoutMs: 10_000,
      });
      if (!response.ok) {
        throw new Error(`PostHog answered ${response.status}`);
      }
      await usage.subtract(carried);
      await saveState({
        lastSentAt: attemptAt,
        lastAttemptAt: attemptAt,
        lastError: null,
      });
      ctx.log.info("Sent daily usage statistics");
      return { sent: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await saveState({ lastAttemptAt: attemptAt, lastError: message });
      ctx.log.warn(`Could not send usage statistics: ${message}`);
      throw error;
    }
  }

  return {
    state,
    send,

    async status() {
      const settings = await readSettings(ctx);
      return {
        enabled: isEnabled(settings, env),
        locked: envOverride(env) !== null,
        instanceId: settings.instanceId || null,
        nextDueAt: await nextDueAt(),
        ...(await state()),
      };
    },

    async preview() {
      return (await buildPayload(ctx, usage, env)).payload;
    },

    async resetInstanceId(): Promise<string> {
      const id = randomUUID();
      await ctx.settings.set("instanceId", id);
      return id;
    },
  };
}

export type Reporter = ReturnType<typeof createReporter>;
