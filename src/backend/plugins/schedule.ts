/**
 * ctx.schedule: timers a plugin owns. They live in the plugin's disposable
 * bag, so deactivate clears every one of them.
 */

import type { PluginSchedule } from "@termix/plugin-sdk/backend";
import type { DisposableBag } from "./disposables.js";

type Log = (message: string, error: unknown) => void;

export function createPluginSchedule(
  bag: DisposableBag,
  logError: Log,
): PluginSchedule {
  const run = async (fn: () => void | Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      logError("Scheduled job failed", error);
    }
  };

  return {
    every: (intervalMs, fn, options) => {
      let running = false;
      let stopped = false;
      let interval: NodeJS.Timeout | undefined;

      const tick = () => {
        if (running || stopped) return;
        running = true;
        void run(fn).finally(() => {
          running = false;
        });
      };

      const jitter = Math.max(0, Math.floor(options?.jitterMs ?? 0));
      const start = setTimeout(
        () => {
          if (stopped) return;
          interval = setInterval(tick, Math.max(1, intervalMs));
          if (jitter > 0) tick();
        },
        jitter > 0 ? Math.floor(Math.random() * jitter) : 0,
      );
      if (options?.runNow) tick();

      let drop = () => {};
      const stop = () => {
        if (stopped) return;
        stopped = true;
        clearTimeout(start);
        if (interval) clearInterval(interval);
        drop();
      };
      drop = bag.add(stop, "scheduled job");
      return stop;
    },

    after: (delayMs, fn) => {
      let done = false;
      let drop = () => {};
      const timer = setTimeout(
        () => {
          done = true;
          drop();
          void run(fn);
        },
        Math.max(0, delayMs),
      );
      const cancel = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        drop();
      };
      drop = bag.add(cancel, "scheduled job");
      return cancel;
    },
  };
}
