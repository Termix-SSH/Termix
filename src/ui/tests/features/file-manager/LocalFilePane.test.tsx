import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LocalFilePane } from "@/features/file-manager/LocalFilePane";
import {
  LOCAL_FILES_DRAG_MIME,
  REMOTE_FILES_DRAG_MIME,
} from "@/features/file-manager/local-transfer-utils";
import type { LocalFileEntry } from "@/types/electron";

// jsdom has no layout, so render every row instead of a virtual window.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 34,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 34,
        size: 34,
      })),
    measureElement: () => {},
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.count !== undefined ? `${key}:${opts.count}` : key,
  }),
}));

const HOME = "/Users/max";

const entries: LocalFileEntry[] = [
  {
    name: "projects",
    path: `${HOME}/projects`,
    type: "directory",
    size: 0,
    modifiedTimestamp: 1_700_000_000_000,
    hidden: false,
  },
  {
    name: "notes.txt",
    path: `${HOME}/notes.txt`,
    type: "file",
    size: 1234,
    modifiedTimestamp: 1_700_000_000_000,
    hidden: false,
  },
  {
    name: ".zshrc",
    path: `${HOME}/.zshrc`,
    type: "file",
    size: 42,
    modifiedTimestamp: 1_700_000_000_000,
    hidden: true,
  },
];

function installElectronApi() {
  const list = vi.fn(async (dirPath: string) => ({
    success: true as const,
    path: dirPath,
    parent:
      dirPath === "/" ? null : dirPath.split("/").slice(0, -1).join("/") || "/",
    entries: dirPath === HOME ? entries : [],
  }));
  const api = {
    isElectron: true,
    localFs: {
      home: vi.fn(async () => ({
        success: true as const,
        home: HOME,
        separator: "/",
        platform: "darwin",
      })),
      list,
      mkdir: vi.fn(),
      ensureDir: vi.fn(),
      walk: vi.fn(),
      reveal: vi.fn(),
      open: vi.fn(),
    },
    localTransfer: {
      upload: vi.fn(),
      download: vi.fn(),
      cancel: vi.fn(),
      onProgress: vi.fn(() => () => {}),
    },
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  (window as unknown as { IS_ELECTRON: boolean }).IS_ELECTRON = true;
  return api;
}

function makeDataTransfer(
  types: string[],
  data: Record<string, string> = {},
): DataTransfer {
  const store: Record<string, string> = { ...data };
  return {
    types,
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    getData: (type: string) => store[type] ?? "",
    setData: (type: string, value: string) => {
      store[type] = value;
      if (!types.includes(type)) types.push(type);
    },
    clearData: vi.fn(),
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
}

describe("LocalFilePane", () => {
  beforeEach(() => {
    localStorage.clear();
    installElectronApi();
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it("lists the home directory on mount and remembers the last path", async () => {
    render(<LocalFilePane onRemoteItemsDropped={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByDisplayValue(HOME)).toBeInTheDocument(),
    );
    expect(
      screen.getByText("fileManager.localItemCount:3"),
    ).toBeInTheDocument();
    expect(localStorage.getItem("termix:file-manager:local-pane:path")).toBe(
      HOME,
    );
  });

  it("navigates into a folder on double click", async () => {
    const api = installElectronApi();
    render(<LocalFilePane onRemoteItemsDropped={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByDisplayValue(HOME)).toBeInTheDocument(),
    );

    const row = document.querySelector(`[data-local-path="${HOME}/projects"]`);
    expect(row).not.toBeNull();
    fireEvent.click(row!, { detail: 2 });

    await waitFor(() =>
      expect(api.localFs.list).toHaveBeenCalledWith(`${HOME}/projects`),
    );
  });

  it("accepts remote-grid drops and hands paths to the parent", async () => {
    const onRemoteItemsDropped = vi.fn();
    render(<LocalFilePane onRemoteItemsDropped={onRemoteItemsDropped} />);
    await waitFor(() =>
      expect(screen.getByDisplayValue(HOME)).toBeInTheDocument(),
    );

    const pane = screen.getByTestId("local-file-pane");
    const payload = JSON.stringify({
      type: "internal_files",
      files: ["/srv/app/a.log", "/srv/app/dir"],
    });
    const dataTransfer = makeDataTransfer(
      [REMOTE_FILES_DRAG_MIME, "text/plain"],
      { "text/plain": payload, [REMOTE_FILES_DRAG_MIME]: "1" },
    );

    fireEvent.dragEnter(pane, { dataTransfer });
    expect(
      screen.getByText("fileManager.dropToDownloadHere"),
    ).toBeInTheDocument();

    fireEvent.drop(pane, { dataTransfer });
    expect(onRemoteItemsDropped).toHaveBeenCalledWith(
      ["/srv/app/a.log", "/srv/app/dir"],
      HOME,
    );
    expect(
      screen.queryByText("fileManager.dropToDownloadHere"),
    ).not.toBeInTheDocument();
  });

  it("drops onto a folder row download into that folder", async () => {
    const onRemoteItemsDropped = vi.fn();
    render(<LocalFilePane onRemoteItemsDropped={onRemoteItemsDropped} />);
    await waitFor(() =>
      expect(screen.getByDisplayValue(HOME)).toBeInTheDocument(),
    );

    const folderRow = document.querySelector(
      `[data-local-path="${HOME}/projects"]`,
    )!;
    const payload = JSON.stringify({
      type: "internal_files",
      files: ["/srv/app/a.log"],
    });
    const dataTransfer = makeDataTransfer(
      [REMOTE_FILES_DRAG_MIME, "text/plain"],
      { "text/plain": payload, [REMOTE_FILES_DRAG_MIME]: "1" },
    );
    fireEvent.dragOver(folderRow, { dataTransfer });
    fireEvent.drop(folderRow, { dataTransfer });
    expect(onRemoteItemsDropped).toHaveBeenCalledWith(
      ["/srv/app/a.log"],
      `${HOME}/projects`,
    );
  });

  it("hides dotfiles when hidden files are toggled off", async () => {
    render(<LocalFilePane onRemoteItemsDropped={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByDisplayValue(HOME)).toBeInTheDocument(),
    );
    expect(
      document.querySelector(`[data-local-path="${HOME}/.zshrc"]`),
    ).not.toBeNull();

    fireEvent.click(screen.getByTitle("fileManager.localHideHidden"));
    expect(
      document.querySelector(`[data-local-path="${HOME}/.zshrc"]`),
    ).toBeNull();
    expect(
      screen.getByText("fileManager.localItemCount:2"),
    ).toBeInTheDocument();
  });

  it("ignores OS file drags (those belong to the remote grid)", async () => {
    const onRemoteItemsDropped = vi.fn();
    render(<LocalFilePane onRemoteItemsDropped={onRemoteItemsDropped} />);
    await waitFor(() =>
      expect(screen.getByDisplayValue(HOME)).toBeInTheDocument(),
    );

    const pane = screen.getByTestId("local-file-pane");
    const dataTransfer = makeDataTransfer(["Files"]);
    fireEvent.dragEnter(pane, { dataTransfer });
    expect(
      screen.queryByText("fileManager.dropToDownloadHere"),
    ).not.toBeInTheDocument();
    fireEvent.drop(pane, { dataTransfer });
    expect(onRemoteItemsDropped).not.toHaveBeenCalled();
  });

  it("puts a typed payload on drags that start in the pane", async () => {
    render(<LocalFilePane onRemoteItemsDropped={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByDisplayValue(HOME)).toBeInTheDocument(),
    );

    const row = document.querySelector(`[data-local-path="${HOME}/notes.txt"]`);
    expect(row).not.toBeNull();

    const dataTransfer = makeDataTransfer([]);
    fireEvent.dragStart(row!, { dataTransfer });
    expect(dataTransfer.types).toContain(LOCAL_FILES_DRAG_MIME);
    expect(JSON.parse(dataTransfer.getData("text/plain"))).toEqual({
      type: "local_files",
      paths: [`${HOME}/notes.txt`],
    });
  });
});
