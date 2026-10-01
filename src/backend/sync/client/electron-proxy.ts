import {
  isElectronIpcAvailable,
  requestFromElectronMain,
} from "../../utils/electron-ipc-bridge.js";
import type { SyncLink } from "./link-store.js";

/**
 * Chromium's own requests to the linked server (the sign-in page, remote
 * terminals, file transfers) cannot set headers themselves, so Electron's
 * main process adds the proxy headers and answers basic auth for that one
 * origin. Sent again whenever the link changes; null clears it.
 */
export async function applyElectronProxyConfig(
  link:
    | (Pick<
        SyncLink,
        "serverUrl" | "customHeaders" | "basicAuth" | "allowInvalidCertificate"
      > & { sessionToken?: string | null; status?: string })
    | null,
): Promise<void> {
  if (!isElectronIpcAvailable()) return;
  await requestFromElectronMain(
    "sync-proxy-config",
    link
      ? {
          origin: new URL(link.serverUrl).origin,
          serverUrl: link.serverUrl,
          token:
            link.status === "signed_out" ? null : (link.sessionToken ?? null),
          headers: link.customHeaders ?? [],
          basicAuth: link.basicAuth ?? null,
          allowInvalidCertificate: !!link.allowInvalidCertificate,
        }
      : null,
  );
}
