import "@testing-library/jest-dom/vitest";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { FileWindow } from "../../../src/frontend/components/FileWindow";
import { DiffViewer } from "../../../src/frontend/components/DiffViewer";
import type { FileItem, SSHHost } from "../../../src/frontend/host-types";

const api = vi.hoisted(() => ({
  downloadSSHFileStream: vi.fn(),
  downloadSSHFile: vi.fn(async () => ({ content: "eA==" })),
  readSSHFile: vi.fn(async () => ({ content: "text", encoding: "utf8" })),
  getSSHStatus: vi.fn(async () => ({ connected: true })),
  connectSSH: vi.fn(),
  writeSSHFile: vi.fn(),
}));
vi.mock("../../../src/frontend/api/ssh-file-operations-api", () => api);
vi.mock("sonner", () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { name?: string }) =>
      params?.name ? `${key}: ${params.name}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("../../../src/frontend/components/WindowManager", () => ({
  useWindowManager: () => ({
    windows: [{ id: "preview" }],
    closeWindow: vi.fn(),
    maximizeWindow: vi.fn(),
    focusWindow: vi.fn(),
  }),
}));
vi.mock("../../../src/frontend/components/DraggableWindow", () => ({
  DraggableWindow: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("../../../src/frontend/components/FileViewer", () => ({
  FileViewer: ({ onDownload }: { onDownload: () => void }) => (
    <button onClick={onDownload}>download-preview</button>
  ),
}));
vi.mock("@monaco-editor/react", () => ({ DiffEditor: () => null }));

const file1: FileItem = { name: "one.txt", path: "/one.txt", type: "file" };
const file2: FileItem = { name: "two.txt", path: "/two.txt", type: "file" };
const host = { id: 1, name: "host", ip: "127.0.0.1", port: 22 } as SSHHost;
let transfers: Array<{
  progress: (event: { loaded: number; total?: number }) => void;
  resolve: () => void;
  reject: (error: Error) => void;
}>;

beforeEach(() => {
  vi.clearAllMocks();
  api.connectSSH.mockReset();
  let nextId = 0;
  vi.mocked(toast.loading).mockImplementation(
    (_node, options) => options?.id ?? ++nextId,
  );
  transfers = [];
  api.downloadSSHFileStream.mockImplementation(
    (_session, _path, progress) =>
      new Promise<void>((resolve, reject) => {
        transfers.push({ progress, resolve, reject });
      }),
  );
});
afterEach(cleanup);

async function open(kind: string) {
  if (kind === "preview") {
    render(
      <FileWindow
        windowId="preview"
        file={{ ...file1 }}
        sshSessionId="session"
        sshHost={host}
      />,
    );
    return screen.findByRole("button", { name: "download-preview" });
  }
  render(
    <DiffViewer
      file1={file1}
      file2={file2}
      sshSessionId="session"
      sshHost={host}
    />,
  );
  return screen.findByRole("button", { name: file1.name });
}

describe.each(["preview", "comparison"])("%s download feedback", (kind) => {
  it("clears the loading state if the connection check fails", async () => {
    const button = await open(kind);
    api.getSSHStatus.mockRejectedValueOnce(new Error("connection failed"));
    api.connectSSH.mockRejectedValueOnce(new Error("connection failed"));
    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const id = vi.mocked(toast.loading).mock.results[0].value;
    expect(toast.error).toHaveBeenLastCalledWith(expect.any(String), {
      id,
      duration: undefined,
    });
    expect(api.downloadSSHFileStream).not.toHaveBeenCalled();
  });

  it("updates one progress toast, then replaces it on completion", async () => {
    fireEvent.click(await open(kind));
    await waitFor(() => expect(transfers).toHaveLength(1));
    const id = vi.mocked(toast.loading).mock.results[0].value;
    expect(toast.loading).toHaveBeenCalledWith(expect.anything(), {
      duration: Infinity,
    });
    expect(toast.success).not.toHaveBeenCalled();
    act(() => transfers[0].progress({ loaded: 50, total: 100 }));
    const last = vi.mocked(toast.loading).mock.calls.at(-1)!;
    expect(last[1]).toEqual({ id, duration: Infinity });
    render(<>{last[0] as React.ReactNode}</>);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    await act(async () => transfers[0].resolve());
    expect(toast.success).toHaveBeenCalledWith(expect.any(String), {
      id,
      duration: undefined,
    });
    expect(api.downloadSSHFile).not.toHaveBeenCalled();
  });

  it("replaces the loading toast with an error when the download fails", async () => {
    fireEvent.click(await open(kind));
    await waitFor(() => expect(transfers).toHaveLength(1));
    const id = vi.mocked(toast.loading).mock.results[0].value;
    await act(async () => transfers[0].reject(new Error("read failed")));
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("read failed"),
      { id, duration: undefined },
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});

it("keeps simultaneous comparison downloads in separate toasts", async () => {
  fireEvent.click(await open("comparison"));
  fireEvent.click(screen.getByRole("button", { name: file2.name }));
  await waitFor(() => expect(transfers).toHaveLength(2));
  const ids = vi
    .mocked(toast.loading)
    .mock.results.map((result) => result.value);
  expect(ids[0]).not.toBe(ids[1]);
  act(() => transfers[0].progress({ loaded: 1 }));
  expect(toast.loading).toHaveBeenLastCalledWith(expect.anything(), {
    id: ids[0],
    duration: Infinity,
  });
  act(() => transfers[1].progress({ loaded: 2 }));
  expect(toast.loading).toHaveBeenLastCalledWith(expect.anything(), {
    id: ids[1],
    duration: Infinity,
  });
  await act(async () => {
    transfers[1].resolve();
    transfers[0].resolve();
  });
  expect(toast.success).toHaveBeenCalledTimes(2);
});
