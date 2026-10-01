import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { envOverride } from "./config.js";
import { isEnabled, readSettings } from "./collect.js";
import { CHECK_INTERVAL_MS, createReporter } from "./reporter.js";
import { registerRoutes } from "./routes.js";
import { createUsageStore } from "./usage.js";

/** First check a few minutes after boot, once core's boot copies ran. */
const FIRST_CHECK_DELAY_MS = 3 * 60 * 1000;

type Env = Record<string, string | undefined>;

export async function activateWith(ctx: PluginContext, env: Env) {
  const usage = createUsageStore(ctx.kv);
  const reporter = createReporter(ctx, usage, env);

  const check = async () => {
    try {
      await reporter.send();
    } catch {
      // Logged by the reporter; the next check tries again.
    }
  };
  ctx.schedule.after(FIRST_CHECK_DELAY_MS, check);
  ctx.schedule.every(CHECK_INTERVAL_MS, check);

  const countEvent = (feature: string) => async () => {
    const settings = await readSettings(ctx);
    if (isEnabled(settings, env) && settings.includeFeatureUsage) {
      await usage.add({ [feature]: 1 });
    }
  };
  const onLogin = countEvent("ssh_login");
  const onConnected = countEvent("host_connected");
  ctx.events.on("host.login", () => void onLogin().catch(() => undefined));
  ctx.events.on("host.session.status", (payload) => {
    if ((payload as { online?: boolean } | null)?.online) {
      void onConnected().catch(() => undefined);
    }
  });

  ctx.settings.onValidate("admin", async (values) => {
    const locked = envOverride(env);
    if (locked === null || values.enabled === undefined) return;
    const stored = (await ctx.settings.get<boolean>("enabled")) !== false;
    if (values.enabled !== stored) {
      return {
        enabled:
          "This is set by the ENABLE_TELEMETRY environment variable and cannot be changed here.",
      };
    }
  });

  registerRoutes(ctx, ctx.http.router<Router>(), reporter, usage, env);
  return { reporter, usage };
}

export async function activate(ctx: PluginContext) {
  await activateWith(ctx, process.env);
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
