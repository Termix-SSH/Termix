import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  getSSHHosts: vi.fn(),
  getSSHFolders: vi.fn(async () => []),
}));
vi.mock("@/main-axios", () => api);

import { useHostList } from "@/shell/controller/use-hosts";

afterEach(cleanup);

function host(id: number, name: string) {
  return { id, name, ip: "10.0.0.1", port: 22, username: "root", folder: "" };
}

describe("useHostList", () => {
  it("keeps the newest reload when an older one answers last", async () => {
    let finishOld: (value: unknown[]) => void = () => {};
    api.getSSHHosts
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = resolve;
        }),
      )
      .mockResolvedValueOnce([host(2, "new")]);

    const { result } = renderHook(() => useHostList());
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.list.map((h) => h.name)).toEqual(["new"]);

    await act(async () => finishOld([host(1, "old")]));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.list.map((h) => h.name)).toEqual(["new"]);
  });
});
