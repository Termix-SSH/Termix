/**
 * Plugins whose frames could not start. Their parts are gone from the app,
 * so say so once, grouped, instead of only in the console.
 */

import { toast } from "sonner";
import i18n from "@/i18n/i18n";

const GROUP_MS = 1_500;

const waiting = new Map<string, string>();
const told = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  timer = null;
  if (waiting.size === 0) return;
  const names = [...waiting.keys()];
  const reason = [...waiting.values()][0];
  waiting.clear();
  // The proxy check already showed its own message with a fix.
  if (reason === i18n.t("plugins.framesBlocked")) return;
  toast.error(
    i18n.t("plugins.framesFailed", {
      count: names.length,
      names: names.join(", "),
    }),
    {
      description: reason,
      duration: 15_000,
      action: {
        label: i18n.t("plugins.framesFailedReload"),
        onClick: () => window.location.reload(),
      },
    },
  );
}

export function reportFrameFailure(name: string, reason: string): void {
  if (told.has(name)) return;
  told.add(name);
  waiting.set(name, reason);
  timer ??= setTimeout(flush, GROUP_MS);
}

/** Test seam. */
export function resetFrameFailures(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  waiting.clear();
  told.clear();
}
