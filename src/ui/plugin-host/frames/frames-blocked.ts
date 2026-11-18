/**
 * Frames are sandboxed, so the browser sends no cookies with what they load.
 * A login proxy in front of Termix then turns those requests away and no
 * frame ever starts. /plugin-assets needs no login, so a cookie-less request
 * there that is refused or redirected can only come from such a proxy.
 */

import { toast } from "sonner";
import i18n from "@/i18n/i18n";
import { docsUrl } from "@/lib/docs";
import { frameUrl } from "./frame-connection";

let probe: Promise<boolean> | null = null;
let warned = false;

export function framesBlocked(pluginId: string): Promise<boolean> {
  probe ??= fetch(frameUrl(pluginId, {}), {
    credentials: "omit",
    redirect: "manual",
    cache: "no-store",
  })
    .then(
      (response) =>
        response.type === "opaqueredirect" ||
        response.status === 401 ||
        response.status === 403,
    )
    .catch(() => false);
  return probe;
}

/** Why a frame did not start, when a proxy is the reason. Warns once. */
export async function frameBlockedReason(
  pluginId: string,
): Promise<string | null> {
  if (!(await framesBlocked(pluginId))) return null;
  const message = i18n.t("plugins.framesBlocked");
  if (!warned) {
    warned = true;
    toast.error(message, {
      duration: Infinity,
      action: {
        label: i18n.t("plugins.framesBlockedHelp"),
        onClick: () =>
          window.open(docsUrl("loginProxies"), "_blank", "noopener"),
      },
    });
  }
  return message;
}

/** Test seam. */
export function resetFramesBlocked(): void {
  probe = null;
  warned = false;
}
