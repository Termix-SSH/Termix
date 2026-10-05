import type { HostDraft } from "@termix-ssh/plugin-sdk/frontend";
import type { HostDefaultsLevel } from "@/types/host-defaults";

export type ManageMode = "hosts" | "credentials" | "defaults";

/** What to open in the Manage tab. */
export type ManageRequest =
  | { kind: "host"; hostId: string | null; draft?: HostDraft }
  | { kind: "credential"; credentialId: string | null }
  | { kind: "defaults"; level: HostDefaultsLevel; folderName?: string }
  | { kind: "browse"; mode: ManageMode };

export const MANAGE_REQUEST_EVENT = "manage:request";

let pending: ManageRequest | null = null;

/**
 * Parks a request for the Manage tab and pokes it. The shell opens the tab on
 * the same event, and the tab claims the parked request once it mounts.
 */
export function requestManage(request: ManageRequest): void {
  pending = request;
  window.dispatchEvent(new Event(MANAGE_REQUEST_EVENT));
}

/** Takes the parked request, leaving none behind. */
export function takePendingManageRequest(): ManageRequest | null {
  const request = pending;
  pending = null;
  return request;
}

/**
 * The window events older callers fire (the dashboard, folder menus, the
 * palette), turned into a request. Null for anything else.
 */
export function requestFromLegacyEvent(
  name: string,
  detail?: unknown,
): ManageRequest | null {
  switch (name) {
    case "host-manager:add-host":
      return {
        kind: "host",
        hostId: null,
        draft: (detail as HostDraft | undefined) ?? undefined,
      };
    case "host-manager:edit-host":
      return detail ? { kind: "host", hostId: String(detail) } : null;
    case "host-manager:add-credential":
      return { kind: "credential", credentialId: null };
    case "host-manager:show-credentials":
      return { kind: "browse", mode: "credentials" };
    case "host-manager:edit-defaults":
    case "termix:open-host-defaults": {
      const target = detail as
        { level?: HostDefaultsLevel; folderName?: string } | undefined;
      if (!target?.level) return { kind: "browse", mode: "defaults" };
      return {
        kind: "defaults",
        level: target.level,
        folderName: target.folderName,
      };
    }
    default:
      return null;
  }
}

/** Test seam. */
export function resetManageRequests(): void {
  pending = null;
}
