import type {
  PluginContext,
  PluginTlsReloadResult,
  PluginTlsStatus,
} from "@termix/plugin-sdk/backend";
import type { IssuedCertificate } from "./acme.js";
import { renewalReason } from "./renewal.js";
import {
  SETTING_KEYS,
  missingSetting,
  readSettings,
  type AcmeSettings,
} from "./settings.js";

export const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
/** After a failed attempt, the scheduled check waits this long to retry. */
export const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

const STATE_KEY = "state";

export interface AcmeState {
  lastAttemptAt: string | null;
  lastIssuedAt: string | null;
  lastError: string | null;
}

export type IssueFn = (
  ctx: PluginContext,
  settings: AcmeSettings,
) => Promise<IssuedCertificate>;

export class AcmeNotConfiguredError extends Error {
  constructor(readonly field: string) {
    super(`ACME is not configured: ${field} is missing`);
  }
}

export interface IssueResult {
  tls: PluginTlsStatus;
  reload: PluginTlsReloadResult;
}

export interface AcmeRunner {
  state: () => Promise<AcmeState>;
  /** Issues now, whatever the served certificate looks like. */
  issue: () => Promise<IssueResult>;
  /** The scheduled check: issues only when renewal is on and due. */
  check: (now?: Date) => Promise<boolean>;
  /** Registers or drops the renewer to match the current settings. */
  syncRenewer: () => Promise<void>;
}

export function createAcmeRunner(
  ctx: PluginContext,
  issue: IssueFn,
): AcmeRunner {
  let running: Promise<IssueResult> | null = null;
  let dropRenewer: (() => void) | null = null;

  const state = async (): Promise<AcmeState> => {
    const stored = (await ctx.kv.get(STATE_KEY)) as Partial<AcmeState> | null;
    return {
      lastAttemptAt: stored?.lastAttemptAt ?? null,
      lastIssuedAt: stored?.lastIssuedAt ?? null,
      lastError: stored?.lastError ?? null,
    };
  };

  const record = async (patch: Partial<AcmeState>) => {
    await ctx.kv.set(STATE_KEY, { ...(await state()), ...patch });
  };

  const runIssue = async (): Promise<IssueResult> => {
    const settings = await readSettings(ctx);
    const missing = missingSetting(settings);
    if (missing) throw new AcmeNotConfiguredError(missing);

    const attemptAt = new Date().toISOString();
    try {
      const issued = await issue(ctx, settings);
      await ctx.system.writeTlsCertificate(
        issued.certificate,
        issued.privateKey,
      );
      const reload = await ctx.system.reloadTls();
      await record({
        lastAttemptAt: attemptAt,
        lastIssuedAt: new Date().toISOString(),
        lastError: null,
      });
      ctx.log.info(`Certificate issued for ${settings.domain}`);
      return { tls: await ctx.system.tlsStatus(), reload };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await record({ lastAttemptAt: attemptAt, lastError: message });
      throw error;
    }
  };

  const runner: AcmeRunner = {
    state,

    issue: () => {
      running ??= runIssue().finally(() => {
        running = null;
      });
      return running;
    },

    check: async (now = new Date()) => {
      const settings = await readSettings(ctx);
      if (!settings.autoRenew || missingSetting(settings)) return false;

      const last = await state();
      if (
        last.lastError &&
        last.lastAttemptAt &&
        now.getTime() - new Date(last.lastAttemptAt).getTime() < RETRY_AFTER_MS
      ) {
        return false;
      }

      const reason = renewalReason(
        await ctx.system.tlsStatus(),
        settings.domain,
        now,
      );
      if (!reason) return false;

      ctx.log.info(
        `Renewing the certificate for ${settings.domain} (${reason})`,
      );
      try {
        await runner.issue();
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.log.error(
          "Certificate renewal failed",
          error instanceof Error ? error : new Error(message),
        );
        await ctx.notify
          .send({
            title: `Certificate renewal failed for ${settings.domain}`,
            body: message,
            severity: "critical",
            category: "acme-ssl.renewal_failed",
            audience: "admins",
            dedupeKey: `acme-ssl.renewal_failed:${settings.domain}`,
          })
          .catch(() => {});
        return false;
      }
    },

    syncRenewer: async () => {
      const settings = await readSettings(ctx);
      const wanted = settings.autoRenew && !missingSetting(settings);
      if (wanted && !dropRenewer) {
        dropRenewer = await ctx.system.registerTlsRenewer();
      } else if (!wanted && dropRenewer) {
        dropRenewer();
        dropRenewer = null;
      }
    },
  };

  return runner;
}

export function watchSettings(ctx: PluginContext, onChange: () => void): void {
  for (const key of SETTING_KEYS) ctx.settings.onChange(key, onChange);
}
