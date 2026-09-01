import { describe, expect, it, vi, beforeEach } from "vitest";

const authApiMock = vi.hoisted(() => ({
  get: vi.fn(async () => ({ data: [] })),
  post: vi.fn(async () => ({ data: {} })),
  patch: vi.fn(async () => ({ data: {} })),
  put: vi.fn(async () => ({ data: {} })),
  delete: vi.fn(async () => ({ data: { success: true } })),
}));

vi.mock("@/main-axios", () => ({
  authApi: authApiMock,
  handleApiError: (error: unknown) => error,
}));

import {
  listWorkspaces,
  createWorkspace,
  renameWorkspace,
  updateWorkspaceContent,
  deleteWorkspace,
  duplicateWorkspace,
  setDefaultWorkspace,
  applyWorkspaceServer,
  getLastSessionWorkspace,
  saveLastSessionWorkspace,
} from "../../api/workspaces-api";
import type { WorkspacePayload } from "@/types/ui-types";

beforeEach(() => {
  authApiMock.get.mockClear();
  authApiMock.post.mockClear();
  authApiMock.patch.mockClear();
  authApiMock.put.mockClear();
  authApiMock.delete.mockClear();
});

const samplePayload: WorkspacePayload = {
  version: 1,
  tabs: [],
  activeSlotId: null,
  splitMode: "none",
  paneTabIds: [null, null, null, null, null, null],
  rowSizes: [100],
  rowColSizes: [[100]],
};

describe("workspaces-api", () => {
  it("listWorkspaces GETs /workspaces", async () => {
    authApiMock.get.mockResolvedValueOnce({ data: [{ id: 1 }] });
    const result = await listWorkspaces();
    expect(authApiMock.get).toHaveBeenCalledWith("/workspaces");
    expect(result).toEqual([{ id: 1 }]);
  });

  it("createWorkspace POSTs /workspaces with the payload", async () => {
    await createWorkspace({
      name: "Test A",
      color: "#fff",
      payload: samplePayload,
    });
    expect(authApiMock.post).toHaveBeenCalledWith("/workspaces", {
      name: "Test A",
      color: "#fff",
      payload: samplePayload,
    });
  });

  it("renameWorkspace PATCHes /workspaces/:id", async () => {
    await renameWorkspace(5, { name: "New Name" });
    expect(authApiMock.patch).toHaveBeenCalledWith("/workspaces/5", {
      name: "New Name",
    });
  });

  it("updateWorkspaceContent PUTs /workspaces/:id/content", async () => {
    await updateWorkspaceContent(5, samplePayload);
    expect(authApiMock.put).toHaveBeenCalledWith("/workspaces/5/content", {
      payload: samplePayload,
    });
  });

  it("deleteWorkspace DELETEs /workspaces/:id", async () => {
    await deleteWorkspace(5);
    expect(authApiMock.delete).toHaveBeenCalledWith("/workspaces/5");
  });

  it("duplicateWorkspace POSTs /workspaces/:id/duplicate with a name", async () => {
    await duplicateWorkspace(5, "Test A (copy)");
    expect(authApiMock.post).toHaveBeenCalledWith("/workspaces/5/duplicate", {
      name: "Test A (copy)",
    });
  });

  it("setDefaultWorkspace POSTs /workspaces/:id/set-default", async () => {
    await setDefaultWorkspace(5);
    expect(authApiMock.post).toHaveBeenCalledWith("/workspaces/5/set-default");
  });

  it("applyWorkspaceServer POSTs /workspaces/:id/apply", async () => {
    await applyWorkspaceServer(5);
    expect(authApiMock.post).toHaveBeenCalledWith("/workspaces/5/apply");
  });

  it("getLastSessionWorkspace GETs /workspaces/last-session", async () => {
    authApiMock.get.mockResolvedValueOnce({ data: null });
    const result = await getLastSessionWorkspace();
    expect(authApiMock.get).toHaveBeenCalledWith("/workspaces/last-session");
    expect(result).toBeNull();
  });

  it("saveLastSessionWorkspace PUTs /workspaces/last-session", async () => {
    await saveLastSessionWorkspace(samplePayload);
    expect(authApiMock.put).toHaveBeenCalledWith("/workspaces/last-session", {
      payload: samplePayload,
    });
  });
});
