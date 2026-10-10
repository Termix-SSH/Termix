import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MANAGE_REQUEST_EVENT,
  requestFromLegacyEvent,
  requestManage,
  resetManageRequests,
  takePendingManageRequest,
} from "@/manage/manage-requests";

afterEach(resetManageRequests);

describe("manage requests", () => {
  it("parks a request until the tab claims it, once", () => {
    const listener = vi.fn();
    window.addEventListener(MANAGE_REQUEST_EVENT, listener);
    requestManage({ kind: "host", hostId: "7" });
    window.removeEventListener(MANAGE_REQUEST_EVENT, listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(takePendingManageRequest()).toEqual({ kind: "host", hostId: "7" });
    expect(takePendingManageRequest()).toBeNull();
  });

  it("keeps only the latest request", () => {
    requestManage({ kind: "browse", mode: "credentials" });
    requestManage({ kind: "credential", credentialId: null });
    expect(takePendingManageRequest()).toEqual({
      kind: "credential",
      credentialId: null,
    });
  });

  it("translates the old host manager events", () => {
    expect(requestFromLegacyEvent("host-manager:add-host")).toEqual({
      kind: "host",
      hostId: null,
      draft: undefined,
    });
    expect(
      requestFromLegacyEvent("host-manager:add-host", { name: "web" }),
    ).toEqual({ kind: "host", hostId: null, draft: { name: "web" } });
    expect(requestFromLegacyEvent("host-manager:edit-host", 12)).toEqual({
      kind: "host",
      hostId: "12",
    });
    expect(requestFromLegacyEvent("host-manager:edit-host")).toBeNull();
    expect(requestFromLegacyEvent("host-manager:add-credential")).toEqual({
      kind: "credential",
      credentialId: null,
    });
    expect(
      requestFromLegacyEvent("termix:open-host-defaults", { level: "admin" }),
    ).toEqual({ kind: "defaults", level: "admin", folderName: undefined });
    expect(
      requestFromLegacyEvent("host-manager:edit-defaults", {
        level: "folder",
        folderName: "Prod",
      }),
    ).toEqual({ kind: "defaults", level: "folder", folderName: "Prod" });
    expect(requestFromLegacyEvent("something-else")).toBeNull();
  });
});
